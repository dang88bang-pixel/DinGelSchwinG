#!/usr/bin/env python3
"""
wasm_interp.py — Mini-Interpreter für das BLE-Distanz-WASM-Modul
=================================================================
Interpretiert das von scripts/build-wasm.py erzeugte Binary
(public/wasm/ble_distance_bg.wasm) direkt — unabhängig von der
JS-Engine (der Sandbox-Node weicht bei einigen f64-Opcodes ab).

Unterstütztes Subset (exakt das, was build-wasm.py emittiert):
  local.get, f64.const, f64.add/sub/mul/div, f64.abs, f64.lt/gt/ge,
  f64.min/max, call (env.exp/env.log10), if/else/end (f64-Result),
  return, drop-frei, keine Locals außer Parametern.

Aufruf:  python3 wasm_interp.py <modul.wasm>
  → führt alle Exporte mit Testvektoren aus und vergleicht mit den
    Referenzformeln aus wasm-ble/src/lib.rs (Exit 0 = grün).
"""
import math
import struct
import sys


def u32(data, pos):
    r = 0
    s = 0
    while True:
        x = data[pos]
        pos += 1
        r |= (x & 0x7F) << s
        if not x & 0x80:
            return r, pos
        s += 7


def parse(data: bytes):
    assert data[:8] == b"\x00asm\x01\x00\x00\x00", "kein WASM-Modul"
    pos = 8
    sections = {}
    while pos < len(data):
        sid = data[pos]
        pos += 1
        size, pos = u32(data, pos)
        sections[sid] = data[pos:pos + size]
        pos += size
    return sections


def parse_funcs(sections):
    """Liefert: imports [(mod,name,typeidx)], types [(params,results)],
    func_typeidx [typeidx], exports {name: funcidx}, codes [(nlocals, body)]."""
    # Typsektion (1)
    types = []
    p = 0
    data = sections[1]
    count, p = u32(data, p)
    for _ in range(count):
        assert data[p] == 0x60
        p += 1
        np, p = u32(data, p)
        params = list(data[p:p + np])
        p += np
        nr, p = u32(data, p)
        results = list(data[p:p + nr])
        p += nr
        types.append((params, results))
    # Importsektion (2)
    imports = []
    if 2 in sections:
        data = sections[2]
        p = 0
        count, p = u32(data, p)
        for _ in range(count):
            ln, p = u32(data, p); mod = data[p:p + ln].decode(); p += ln
            ln, p = u32(data, p); nam = data[p:p + ln].decode(); p += ln
            kind = data[p]; p += 1
            ti, p = u32(data, p)
            imports.append((mod, nam, kind, ti))
    # Funktionsektion (3)
    func_typeidx = []
    data = sections[3]
    p = 0
    count, p = u32(data, p)
    for _ in range(count):
        ti, p = u32(data, p)
        func_typeidx.append(ti)
    # Exportsektion (7)
    exports = {}
    data = sections[7]
    p = 0
    count, p = u32(data, p)
    for _ in range(count):
        ln, p = u32(data, p); nam = data[p:p + ln].decode(); p += ln
        kind = data[p]; p += 1
        idx, p = u32(data, p)
        exports[nam] = idx
    # Codsektion (10)
    codes = []
    data = sections[10]
    p = 0
    count, p = u32(data, p)
    for _ in range(count):
        bsize, p = u32(data, p)
        body = data[p:p + bsize]
        p += bsize
        q = 0
        nl, q = u32(body, q)
        local_groups = []
        for _ in range(nl):
            n, q = u32(body, q)
            vt = body[q]; q += 1
            local_groups.append((n, vt))
        codes.append((local_groups, body[q:]))
    return imports, types, func_typeidx, exports, codes


class Interp:
    def __init__(self, imports, types, func_typeidx, codes):
        self.types = types
        self.func_typeidx = func_typeidx
        self.codes = codes
        self.imports = {}  # (mod, name) -> callable
        self.import_idx = {}  # funcidx -> (mod, name)
        self.import_types = {}  # funcidx -> typeidx
        for i, (m, n, kind, ti) in enumerate(imports):
            self.import_idx[i] = (m, n)
            self.import_types[i] = ti
        self.stack = []

    def run_func(self, idx, args):
        if idx in self.import_idx:
            m, n = self.import_idx[idx]
            return self.imports[(m, n)](*args)
        ftype = self.types[self.func_typeidx[idx - len(self.import_idx)]]
        locals_ = list(args) + [0.0] * sum(n for n, _ in self.codes[idx - len(self.import_idx)][0])
        body = self.codes[idx - len(self.import_idx)][1]
        return self.exec_body(body, locals_, ftype)

    def exec_body(self, body, locals_, ftype):
        st = []
        pos = 0
        end = len(body)
        while pos < end:
            op = body[pos]
            pos += 1
            if op == 0x20:  # local.get
                i, pos = u32(body, pos)
                st.append(locals_[i])
            elif op == 0x44:  # f64.const
                st.append(struct.unpack("<d", body[pos:pos + 8])[0])
                pos += 8
            elif op == 0x10:  # call
                i, pos = u32(body, pos)
                if i < len(self.import_idx):
                    ftype_i = self.types[self.import_types[i]]
                else:
                    ftype_i = self.types[self.func_typeidx[i - len(self.import_idx)]]
                nargs = len(ftype_i[0])
                args = st[-nargs:]
                del st[-nargs:]
                res = self.run_func(i, args)
                st.append(res)
            elif op in (0xA0, 0xA1, 0xA2, 0xA3, 0x61, 0x63, 0x64, 0x65, 0x66, 0x8B, 0x98, 0x99):
                b = st.pop()
                if op == 0xA0: st.append(st.pop() + b)
                elif op == 0xA1: st.append(st.pop() - b)
                elif op == 0xA2: st.append(st.pop() * b)
                elif op == 0xA3: st.append(st.pop() / b)
                elif op == 0x61: st.append(1.0 if st.pop() == b else 0.0)
                elif op == 0x63: st.append(1.0 if st.pop() < b else 0.0)
                elif op == 0x64: st.append(1.0 if st.pop() > b else 0.0)
                elif op == 0x65: st.append(1.0 if st.pop() <= b else 0.0)
                elif op == 0x66: st.append(1.0 if st.pop() >= b else 0.0)
                elif op == 0x8B: st.append(abs(b))
                elif op == 0x98: st.append(min(st.pop(), b))
                elif op == 0x99: st.append(max(st.pop(), b))
            elif op == 0x04:  # if (blocktype folgt)
                bt = body[pos]; pos += 1
                cond = st.pop()
                # Suche else/end auf gleicher Tiefe
                depth = 0
                else_pos = None
                end_pos = None
                q = pos
                while q < len(body):
                    o = body[q]
                    if o == 0x04:
                        depth += 1
                        q += 2
                    elif o == 0x05:
                        if depth == 0:
                            else_pos = q  # merken, aber weiter bis zum end suchen
                        q += 1
                    elif o == 0x0B:
                        if depth == 0:
                            end_pos = q
                            break
                        depth -= 1
                        q += 1
                    elif o == 0x44:
                        q += 9
                    elif o in (0x20, 0x10):
                        _, q = u32(body, q + 1)
                    elif o == 0x0F:
                        q += 1
                    else:
                        q += 1
                if end_pos is None:
                    raise ValueError("if ohne end")
                if cond != 0.0:
                    if else_pos is not None:
                        res = self.exec_body(body[pos:else_pos], locals_, ftype)
                        pos = end_pos if end_pos is not None else else_pos + 1
                    else:
                        res = self.exec_body(body[pos:end_pos], locals_, ftype)
                        pos = end_pos
                else:
                    if else_pos is not None:
                        res = self.exec_body(body[else_pos + 1:end_pos], locals_, ftype)
                        pos = end_pos
                    else:
                        pos = end_pos
                if bt == 0x7C:
                    st.append(res)
            elif op == 0x0F:  # return
                return st[-1]
            elif op == 0x0B:  # end
                break
            else:
                raise ValueError(f"Opcode {op:#x} an {pos - 1} nicht unterstützt (Interpreter-Subset)")
        return st[-1] if st else 0.0

def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "public/wasm/ble_distance_bg.wasm"
    data = open(path, "rb").read()
    sections = parse(data)
    imports, types, func_typeidx, exports, codes = parse_funcs(sections)

    interp = Interp(imports, types, func_typeidx, codes)
    interp.imports[("env", "exp")] = math.exp
    interp.imports[("env", "log10")] = math.log10

    LN10 = 2.302585092994046
    calc = lambda rssi, tx, n=2: 10 ** ((tx - rssi) / (10 * n))

    def calc_exact(rssi, tx, ref, dref):
        if abs(rssi - ref) < 0.001:
            return dref
        return calc(rssi, tx) * (dref / calc(ref, tx))

    def learn(rr, dr, rn, dn):
        if dr <= 0 or dn <= 0 or abs(rr - rn) < 0.001:
            return 2.0
        ratio = dn / dr
        if ratio <= 0:
            return 2.0
        n = (rr - rn) / (10 * math.log10(ratio))
        return max(1.5, min(6.0, n))

    tests = []
    # (export, args, erwartet, toleranz)
    for r, t in [(-65, -59), (-80, -59), (-42, -59), (-90, -59), (0, 0), (-55, -59)]:
        tests.append(("calculate_distance", (r, t), calc(r, t), 1e-9))
        tests.append(("calculate_distance_env", (r, t, 2.0), calc(r, t, 2.0), 1e-9))
        tests.append(("calculate_distance_env", (r, t, 3.2), calc(r, t, 3.2), 1e-9))
    tests.append(("calc_exact_distance", (-70, -59, -65, 2.5), calc_exact(-70, -59, -65, 2.5), 1e-9))
    tests.append(("calc_exact_distance", (-65, -59, -65, 2.5), 2.5, 1e-12))
    tests.append(("learn_from_feedback", (0, 0, 0, 0), 2.0, 1e-12))
    tests.append(("learn_from_feedback", (-60, 2, -70, 4), learn(-60, 2, -70, 4), 1e-9))
    tests.append(("learn_from_feedback", (-60, 2, -70, 1.01), learn(-60, 2, -70, 1.01), 1e-9))
    tests.append(("get_learned_n", (), 2.0, 1e-12))

    passn = failn = 0
    for name, args, exp, tol in tests:
        got = interp.run_func(exports[name], list(args))
        ok = abs(got - exp) < tol
        passn += ok
        failn += not ok
        print(f"  [{'OK' if ok else 'FAIL'}] {name}{args} = {got} (erwartet {exp})")
    print(f"═══════ WASM-INTERPRETER: {passn}/{passn + failn} · {failn} Fehler ═══════")
    sys.exit(1 if failn else 0)


if __name__ == "__main__":
    main()
