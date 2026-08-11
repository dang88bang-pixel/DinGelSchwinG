/**
 * NEXUS-BUILDER v2.2 — WebAuthn-Client (FIDO2-Assertion für kritische Aktionen)
 * =============================================================================
 * Holt eine Challenge vom Server, erstellt im Browser eine WebAuthn-Assertion
 * (navigator.credentials.get) und reicht sie ein. Bei Erfolg liefert der Server
 * ein einmaliges Grant-Token, das bei kritischen Aktionen mitgegeben wird:
 *   - REST: Header 'X-WebAuthn'
 *   - WS:   Query-Parameter 'wa_token' (Browser-WebSocket kann keine Header setzen)
 *
 * Registrierung eines FIDO2-Geräts (einmalig):
 *   registerCredential() → navigator.credentials.create
 */

import { AppError } from "../domain/errors";
import { httpUrl } from "../config";

export interface WebAuthnChallenge {
  challenge: string;
  challengeId: string;
}

function b64uToBytes(b64u: string): Uint8Array {
  const pad = "=".repeat((4 - (b64u.length % 4)) % 4);
  const b64 = b64u.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToB64u(bytes: Uint8Array): string {
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function webAuthnSupported(): boolean {
  return typeof navigator !== "undefined" && "credentials" in navigator && !!navigator.credentials;
}

async function fetchJson(path: string, token: string, body?: unknown): Promise<any> {
  const res = await fetch(httpUrl(path), {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new AppError("AUTH_FAILED", data?.error || `WebAuthn-Fehler ${res.status}`);
  }
  return data;
}

/** WebAuthn-Assertion für einen kritischen Scope erstellen und einreichen.
 *  Liefert das einmalige Grant-Token (Server). */
export async function assertWebAuthn(token: string, scope: string): Promise<string> {
  if (!webAuthnSupported()) {
    throw new AppError(
      "AUTH_FAILED",
      "WebAuthn nicht verfügbar — für diese Aktion ist ein FIDO2-Gerät (z. B. YubiKey) und ein unterstützter Browser erforderlich",
    );
  }
  const challenge = await fetchJson("/api/webauthn/challenge", token, { scope }) as WebAuthnChallenge;

  const publicKey: PublicKeyCredentialRequestOptions = {
    challenge: b64uToBytes(challenge.challenge),
    timeout: 60_000,
    userVerification: "discouraged",
  } as PublicKeyCredentialRequestOptions;
  // rpId nur setzen, wenn der Server eine WEBAUTHN_RP_ID konfiguriert hat —
  // ansonsten leitet der Browser sie aus der aktuellen Origin ab.
  const rpId = import.meta.env.VITE_WEBAUTHN_RP_ID as string | undefined;
  if (rpId) publicKey.rpId = rpId;

  const assertion = (await navigator.credentials.get({ publicKey })) as PublicKeyCredential;
  const response = assertion.response as AuthenticatorAssertionResponse;

  const res = await fetchJson("/api/webauthn/assert", token, {
    challengeId: challenge.challengeId,
    credentialId: bytesToB64u(new Uint8Array(assertion.rawId)),
    clientDataJSON: bytesToB64u(new Uint8Array(response.clientDataJSON)),
    authenticatorData: bytesToB64u(new Uint8Array(response.authenticatorData)),
    signature: bytesToB64u(new Uint8Array(response.signature)),
  });
  if (!res?.ok || !res.token) {
    throw new AppError("AUTH_FAILED", res?.error || "WebAuthn-Assertion fehlgeschlagen");
  }
  return res.token as string;
}

/** FIDO2-Gerät einmalig registrieren (Public Key landet serverseitig in der DB). */
export async function registerCredential(token: string): Promise<string> {
  if (!webAuthnSupported()) {
    throw new AppError("AUTH_FAILED", "WebAuthn nicht verfügbar (Browser/FIDO2-Gerät erforderlich)");
  }
  const challenge = await fetchJson("/api/webauthn/register/challenge", token, {}) as WebAuthnChallenge;

  const publicKey: PublicKeyCredentialCreationOptions = {
    challenge: b64uToBytes(challenge.challenge),
    rp: { name: "HackGPT-CPS Console" },
    user: {
      id: crypto.getRandomValues(new Uint8Array(16)),
      name: "console-user",
      displayName: "Console User",
    },
    pubKeyCredParams: [
      { type: "public-key", alg: -7 }, // ES256 (P-256)
    ],
    timeout: 60_000,
    attestation: "none",
    authenticatorSelection: { userVerification: "discouraged" },
  } as PublicKeyCredentialCreationOptions;
  const rpId = import.meta.env.VITE_WEBAUTHN_RP_ID as string | undefined;
  if (rpId) publicKey.rp = { ...publicKey.rp, id: rpId };

  const cred = (await navigator.credentials.create({ publicKey })) as PublicKeyCredential;
  const response = cred.response as AuthenticatorAttestationResponse;

  const res = await fetchJson("/api/webauthn/register", token, {
    challengeId: challenge.challengeId,
    clientDataJSON: bytesToB64u(new Uint8Array(response.clientDataJSON)),
    attestationObject: bytesToB64u(new Uint8Array(response.attestationObject)),
  });
  if (!res?.ok) {
    throw new AppError("AUTH_FAILED", res?.error || "Registrierung fehlgeschlagen");
  }
  return res.credentialId as string;
}
