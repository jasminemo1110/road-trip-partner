"""The UI's QR choice must reach the background export worker."""
import pytest
import main


@pytest.mark.parametrize('choice,expected', [(None, False), (False, False), (True, True)])
def test_export_forwards_qr_choice(client, auth, monkeypatch, choice, expected):
    captured = {}

    class DeferredThread:
        def __init__(self, *, target, args, daemon):
            captured['args'] = args

        def start(self):
            pass

    monkeypatch.setattr(main.threading, 'Thread', DeferredThread)
    payload = {'include': ['overview-portrait']}
    if choice is not None:
        payload['show_qr'] = choice
    response = client.post('/api/export-images/start', json=payload, headers=auth)
    assert response.status_code == 200
    assert captured['args'][-1] is expected
