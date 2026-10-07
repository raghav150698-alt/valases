from app.core.security import hash_generated_secret, hash_password, verify_generated_secret


def test_generated_secret_is_constant_time_hmac_and_verifies() -> None:
    encoded = hash_generated_secret("generated-secret-with-high-entropy")

    assert encoded.startswith("hmac_sha256$")
    assert verify_generated_secret("generated-secret-with-high-entropy", encoded)
    assert not verify_generated_secret("wrong-secret", encoded)


def test_existing_password_hashes_remain_compatible() -> None:
    encoded = hash_password("legacy-candidate-password")

    assert verify_generated_secret("legacy-candidate-password", encoded)
    assert not verify_generated_secret("wrong-password", encoded)
