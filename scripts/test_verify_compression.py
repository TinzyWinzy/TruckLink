"""Unit checks for the authenticated, read-only compression boundary."""
import gzip
import io
import unittest
from unittest.mock import patch
from verify_compression import fetch, NoAuthenticatedRedirects


class Response(io.BytesIO):
    status = 200
    headers = {'Content-Encoding': 'gzip', 'Content-Type': 'application/json'}


class VerificationTests(unittest.TestCase):
    def test_authenticated_gzip_is_decoded_and_credentials_are_not_reported(self):
        body = b'{"queue":[]}'
        with patch('verify_compression.build_opener') as factory:
            factory.return_value.open.return_value = Response(gzip.compress(body))
            report, decoded = fetch('https://synthetic.example/api/yard/board/', 'gzip', 'synthetic-token')
        request = factory.return_value.open.call_args.args[0]
        self.assertEqual(request.get_header('Authorization'), 'Token synthetic-token')
        self.assertEqual(decoded, body)
        self.assertEqual(report['decoded_bytes'], len(body))
        self.assertNotIn('synthetic-token', str(report))

    def test_authenticated_plain_http_is_rejected_before_network_access(self):
        with patch('verify_compression.build_opener') as factory:
            with self.assertRaisesRegex(ValueError, 'HTTPS'):
                fetch('http://synthetic.example/api/', 'gzip', 'synthetic-token')
            factory.assert_not_called()

    def test_authenticated_redirects_are_rejected(self):
        with self.assertRaisesRegex(ValueError, 'redirects'):
            NoAuthenticatedRedirects().redirect_request(None, None, 302, '', {}, 'https://other.example')


if __name__ == '__main__':
    unittest.main()
