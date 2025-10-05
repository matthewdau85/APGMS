from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import nacl.signing, nacl.encoding, hashlib

app = FastAPI()

class VerifyIn(BaseModel):
    kid: str
    payload_c14n: str
    signature_b64: str
    pubkey_b64: str

@app.post("/verify")
def verify(v: VerifyIn):
    try:
        payload_hash = hashlib.sha256(v.payload_c14n.encode("utf-8")).hexdigest()
        verify_key = nacl.signing.VerifyKey(v.pubkey_b64, encoder=nacl.encoding.Base64Encoder)
        sig = nacl.encoding.Base64Encoder.decode(v.signature_b64)
        verify_key.verify(v.payload_c14n.encode("utf-8"), sig)
        return {"ok": True, "payload_sha256": payload_hash}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))