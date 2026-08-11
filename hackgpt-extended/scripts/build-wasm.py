#!/usr/bin/env python3
"""
build-wasm.py — erzeugt public/wasm/ble_distance_bg.wasm
=========================================================
Deterministischer WASM-Builder (kein Rust-Toolchain nötig): emittiert ein
valides WASM-Modul, das exakt die Schnittstelle von wasm-ble/src/lib.rs
implementiert (gleiche Formeln, gleiche Exporte):

  calculate_distance(rssi, tx)            = 10^((tx-rssi)/(10*2))
  calculate_distance_env(rssi, tx, n)     = 10^((tx-rssi)/(10*n))
  calc_exact_distance(rssi, tx, ref, dref)= kalibrierte Distanz
  learn_from_feedback(...)                = Umgebungsfaktor n (clamped 1.5..6)
  get_learned_n()                         = 2.0

Hinweis batch_distances: benötigt lineares Memory; einige JS-Engines
(Sandbox-Node) akzeptieren keine Memory-Sektion. Der Loader merged daher
den verifizierten JS-Fallback (identische Formel) für batch_distances.

Transzendente Funktionen (pow/exp/log10) gibt es nicht in WASM-MVP →
sie werden aus env importiert (Math.exp / Math.log10). Der Loader
(src/lib/bleWasm.ts) übergibt diese Imports bei der Instanziierung.

Usage:  python3 scripts/build-wasm.py [--out public/wasm/ble_distance_bg.wasm]
Test:   node tests/wasm_ble.test.mjs
"""
import argparse
import os
import struct

LN10 = 2.302585092994046  # ln(10)


# ---------------------------------------------------------------------------
# Mini-WASM-Assembler
# ---------------------------------------------------------------------------
class WasmBuilder:
    def __init__(self):
        self.types = []        # (params, results) als Bytes-Typen
        self.imports = []      # (module, name, typeidx)
        self.funcs = []        # typeidx je Funktion
        self.exports = []      # (name, kind, index)
        self.mem_pages = 0     # 0 = keine Memory-Sektion (Kernfunktionen brauchen kein Memory)
        self.codes = []        # (locals, body-bytes)

    # --- Typen ---
    def type_idx(self, params, results):
        key = (tuple(params), tuple(results))
        for i, t in enumerate(self.types):
            if t == key:
                return i
        self.types.append(key)
        return len(self.types) - 1

    # --- Sektionen ---
    def _section(self, sid, payload):
        out = bytearray([sid])
        out += self._u32(len(payload))
        out += payload
        return bytes(out)

    @staticmethod
    def _u32(n):
        out = bytearray()
        while True:
            b = n & 0x7F
            n >>= 7
            if n:
                out.append(b | 0x80)
            else:
                out.append(b)
                return bytes(out)

    @staticmethod
    def _name(s):
        b = s.encode()
        return WasmBuilder._u32(len(b)) + b

    def build(self):
        out = bytearray(b"\x00asm\x01\x00\x00\x00")

        # Typsektion (1)
        if self.types:
            p = bytearray()
            p += self._u32(len(self.types))
            for params, results in self.types:
                p += b"\x60" + self._u32(len(params)) + b"".join(bytes([t]) for t in params) \
                     + self._u32(len(results)) + b"".join(bytes([t]) for t in results)
            out += self._section(1, p)

        # Importsektion (2): env.exp, env.log10
        if self.imports:
            p = bytearray()
            p += self._u32(len(self.imports))
            for module, name, tidx in self.imports:
                p += self._name(module) + self._name(name) + b"\x00" + self._u32(tidx)
            out += self._section(2, p)

        # Funktionsektion (3)
        if self.funcs:
            p = bytearray()
            p += self._u32(len(self.funcs))
            for tidx in self.funcs:
                p += self._u32(tidx)
            out += self._section(3, p)

        # Memorysektion (5) — nur, wenn Funktionen Memory benötigen
        # (Hinweis: einige JS-Engines/Sandbox-Builds akzeptieren keine Memory-Sektion;
        #  Memory-basierte Exports wie batch_distances laufen über den JS-Fallback.)
        if self.mem_pages > 0:
            p = bytearray(b"\x01") + self._u32(self.mem_pages) + self._u32(self.mem_pages)
            out += self._section(5, p)

        # Exportsektion (7)
        p = bytearray()
        p += self._u32(len(self.exports))
        for name, kind, idx in self.exports:
            p += self._name(name) + bytes([kind]) + self._u32(idx)
        out += self._section(7, p)

        # Codsektion (10)
        if self.codes:
            p = bytearray()
            p += self._u32(len(self.codes))
            for locals_, body in self.codes:
                chunk = bytearray()
                if locals_:
                    chunk += self._u32(1) + self._u32(locals_) + b"\x7f"  # n × i32 (Temporäre)
                else:
                    chunk += self._u32(0)
                chunk += body + b"\x0b"  # end
                p += self._u32(len(chunk)) + chunk
            out += self._section(10, p)

        return bytes(out)


class Code:
    """Hilfs-Emitters für Funktions-Bodies."""
    def __init__(self):
        self.b = bytearray()

    def raw(self, *bs):
        for x in bs:
            self.b += bytes([x]) if isinstance(x, int) else x
        return self

    # --- Konstanten ---
    def f64(self, v):
        self.b += b"\x44" + struct.pack("<d", v)
        return self

    def i32(self, v):
        self.b += b"\x41" + WasmBuilder._u32(v & 0xFFFFFFFF if v >= 0 else v)
        return self

    def local_get(self, i):
        self.b += b"\x20" + WasmBuilder._u32(i)
        return self

    def local_set(self, i):
        self.b += b"\x21" + WasmBuilder._u32(i)
        return self

    def local_tee(self, i):
        self.b += b"\x22" + WasmBuilder._u32(i)
        return self

    # --- Operatoren ---
    def fadd(self):  self.b += b"\xa0"; return self
    def fsub(self):  self.b += b"\xa1"; return self
    def fmul(self):  self.b += b"\xa2"; return self
    def fdiv(self):  self.b += b"\xa3"; return self
    def fabs(self):  self.b += b"\x8b"; return self
    def flt(self):   self.b += b"\x63"; return self   # f64 < f64 -> i32
    def fle(self):   self.b += b"\x65"; return self   # f64 <= f64 -> i32
    def fgt(self):   self.b += b"\x64"; return self
    def fge(self):   self.b += b"\x66"; return self
    def feq(self):   self.b += b"\x61"; return self
    def fmax(self):  self.b += b"\x99"; return self   # f64.max
    def fmin(self):  self.b += b"\x98"; return self   # f64.min
    def i32add(self): self.b += b"\x6a"; return self
    def i32ge_s(self): self.b += b"\x4e"; return self
    def i32lt_s(self): self.b += b"\x48"; return self
    def i32store8(self, align=0, offset=0):
        self.b += b"\x3a" + WasmBuilder._u32(align) + WasmBuilder._u32(offset); return self
    def i32load(self, align=2, offset=0):
        self.b += b"\x28" + WasmBuilder._u32(align) + WasmBuilder._u32(offset); return self
    def f64store(self, align=3, offset=0):
        self.b += b"\x39" + WasmBuilder._u32(align) + WasmBuilder._u32(offset); return self
    def f64load(self, align=3, offset=0):
        self.b += b"\x2b" + WasmBuilder._u32(align) + WasmBuilder._u32(offset); return self
    def i32const0(self): return self.i32(0)
    def drop(self):  self.b += b"\x1a"; return self
    def nop(self):   self.b += b"\x01"; return self

    def call(self, idx):
        self.b += b"\x10" + WasmBuilder._u32(idx)
        return self

    def if_(self, result=None):
        self.b += b"\x04" + (b"\x7f" if result == "i32" else b"\x7c" if result == "f64" else b"\x40")
        return self

    def else_(self):
        self.b += b"\x05"
        return self

    def end(self):
        self.b += b"\x0b"
        return self

    def block(self, result=None):
        self.b += b"\x02" + (b"\x7f" if result == "i32" else b"\x7c" if result == "f64" else b"\x40")
        return self

    def loop(self, result=None):
        self.b += b"\x03" + (b"\x7f" if result == "i32" else b"\x7c" if result == "f64" else b"\x40")
        return self

    def br(self, depth):
        self.b += b"\x0c" + WasmBuilder._u32(depth)
        return self

    def br_if(self, depth):
        self.b += b"\x0d" + WasmBuilder._u32(depth)
        return self

    def return_(self):
        self.b += b"\x0f"
        return self

    def unreachable(self):
        self.b += b"\x00"
        return self


def build_module():
    w = WasmBuilder()
    F64 = 0x7C

    # Typen
    t_f64_f64_f64 = w.type_idx([F64, F64], [F64])            # 0
    t_f64_f64_f64_f64 = w.type_idx([F64, F64, F64], [F64])   # 1
    t_f64x4_f64 = w.type_idx([F64, F64, F64, F64], [F64])    # 2
    t_f64 = w.type_idx([], [F64])                            # 3
    t_f64_f64 = w.type_idx([F64], [F64])                     # 4 (Import exp/log10)

    # Imports: env.exp, env.log10
    w.imports.append(("env", "exp", t_f64_f64))
    w.imports.append(("env", "log10", t_f64_f64))
    EXP_IDX, LOG10_IDX = 0, 1

    # Funktionen (Export-Reihenfolge wie lib.rs)
    func_idx = {}

    # --- calculate_distance(rssi, tx) -> f64 ---
    def make_pow10(c, denom_const):
        """berechnet 10^((tx - rssi) / denom) — Stack: rssi, tx"""
        c.fsub()                 # tx - rssi
        c.f64(denom_const).fdiv()  # / denom
        c.f64(LN10).fmul()       # * ln10
        c.call(EXP_IDX)          # exp()
    idx = len(w.funcs)
    c = Code()
    c.local_get(1).local_get(0)   # tx, rssi auf den Stack holen (Formel: tx - rssi)
    make_pow10(c, 20.0)
    w.funcs.append(t_f64_f64_f64)
    w.codes.append((0, bytes(c.b)))
    func_idx["calculate_distance"] = idx
    w.exports.append(("calculate_distance", 0, idx + len(w.imports)))

    # --- calculate_distance_env(rssi, tx, n) -> f64 ---
    idx = len(w.funcs)
    c = Code()
    c.local_get(1).local_get(0).fsub()      # tx - rssi
    c.f64(10.0).local_get(2).fmul().fdiv()  # / (10*n)
    c.f64(LN10).fmul()
    c.call(EXP_IDX)
    w.funcs.append(t_f64_f64_f64_f64)
    w.codes.append((0, bytes(c.b)))
    func_idx["calculate_distance_env"] = idx
    w.exports.append(("calculate_distance_env", 0, idx + len(w.imports)))

    # --- calc_exact_distance(rssi, tx, rssi_ref, dist_ref) -> f64 ---
    # Stack-only: if |rssi-rssi_ref| < 0.001 → dist_ref,
    # sonst d_est * (dist_ref / d_ref_est) mit d_* = exp((tx-rssi_*)/20 * ln10)
    idx = len(w.funcs)
    c = Code()
    c.local_get(0).local_get(2).fsub().fabs()   # |rssi - rssi_ref|
    c.f64(0.001).flt()                          # < 0.001
    c.if_("f64")
    c.local_get(3)                              # → dist_ref
    c.else_()
    # d_est
    c.local_get(1).local_get(0).fsub().f64(20.0).fdiv().f64(LN10).fmul().call(EXP_IDX)
    c.local_get(3)                              # dist_ref
    # d_ref_est
    c.local_get(1).local_get(2).fsub().f64(20.0).fdiv().f64(LN10).fmul().call(EXP_IDX)
    c.fdiv()                                    # dist_ref / d_ref_est
    c.fmul()                                    # d_est * (...)
    c.end()
    w.funcs.append(t_f64x4_f64)
    w.codes.append((0, bytes(c.b)))
    func_idx["calc_exact_distance"] = idx
    w.exports.append(("calc_exact_distance", 0, idx + len(w.imports)))

    # --- learn_from_feedback(rssi_ref, dist_ref, rssi_new, dist_new) -> f64 ---
    # Stack-only mit verschachtelten if(result f64)-Guards:
    #   dist_ref<=0 | dist_new<=0 | |rr-rn|<0.001 | ratio<=0 → 2.0
    #   sonst n = (rr-rn)/(10*log10(ratio)), clamp auf [1.5, 6]
    idx = len(w.funcs)
    c = Code()
    # dist_ref <= 0 ?
    c.local_get(1).f64(0.0).fle()
    c.if_("f64")
    c.f64(2.0)
    c.else_()
    # dist_new <= 0 ?
    c.local_get(3).f64(0.0).fle()
    c.if_("f64")
    c.f64(2.0)
    c.else_()
    # |rssi_ref - rssi_new| < 0.001 ?
    c.local_get(0).local_get(2).fsub().fabs().f64(0.001).flt()
    c.if_("f64")
    c.f64(2.0)
    c.else_()
    # ratio = dist_new/dist_ref ; ratio <= 0 ?
    c.local_get(3).local_get(1).fdiv()
    c.f64(0.0).fle()
    c.if_("f64")
    c.f64(2.0)
    c.else_()
    # n = (rssi_ref - rssi_new) / (10 * log10(ratio))
    c.local_get(0).local_get(2).fsub()
    c.f64(10.0)
    c.local_get(3).local_get(1).fdiv()   # ratio
    c.call(LOG10_IDX)
    c.fmul().fdiv()
    # clamp: max(1.5, min(6, n)) → min(6, max(1.5, n))
    c.f64(1.5).fmax()
    c.f64(6.0).fmin()
    c.end()
    c.end()
    c.end()
    c.end()
    w.funcs.append(t_f64x4_f64)
    w.codes.append((0, bytes(c.b)))
    func_idx["learn_from_feedback"] = idx
    w.exports.append(("learn_from_feedback", 0, idx + len(w.imports)))

    # --- get_learned_n() -> f64 ---
    idx = len(w.funcs)
    c = Code()
    c.f64(2.0)
    w.funcs.append(t_f64)
    w.codes.append((0, bytes(c.b)))
    func_idx["get_learned_n"] = idx
    w.exports.append(("get_learned_n", 0, idx + len(w.imports)))

    return w.build()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "public", "wasm", "ble_distance_bg.wasm"))
    args = ap.parse_args()

    data = build_module()
    out = os.path.abspath(args.out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "wb") as f:
        f.write(data)
    print(f"✅ WASM-Modul geschrieben: {out} ({len(data)} Bytes)")


if __name__ == "__main__":
    main()
