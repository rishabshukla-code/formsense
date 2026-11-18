"""Import-level checks that the agent wires up without any network calls."""


def test_agent_builds(monkeypatch):
    monkeypatch.setenv("ASSEMBLYAI_API_KEY", "test")
    import agent

    a = agent.FormSenseAgent()
    assert "web_search" in a.instructions
