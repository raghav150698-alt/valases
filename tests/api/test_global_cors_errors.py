import unittest

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient


class GlobalCorsErrorTest(unittest.TestCase):
    def test_unhandled_errors_keep_cors_header(self) -> None:
        api = FastAPI()

        @api.get("/failure")
        def failure() -> None:
            raise RuntimeError("test failure")

        app = CORSMiddleware(
            app=api,
            allow_origins=["https://candidate.example.com"],
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

        response = TestClient(app, raise_server_exceptions=False).get(
            "/failure",
            headers={"Origin": "https://candidate.example.com"},
        )

        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.headers.get("access-control-allow-origin"), "https://candidate.example.com")


if __name__ == "__main__":
    unittest.main()
