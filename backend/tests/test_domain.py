import pytest
from app.domain import empty_state, transition
from app.domain.utf16 import utf16_length, utf16_slice

def test_utf16_offsets_reject_half_emoji():
    assert utf16_length("a😀b") == 4
    assert utf16_slice("a😀b", 1, 3) == "😀"
    with pytest.raises(ValueError): utf16_slice("a😀b", 1, 2)

def test_create_send_and_answer():
    state=transition(empty_state(),{"type":"create","title":"x"}); branch=state["active"]
    state=transition(state,{"type":"send","branchId":branch,"text":"hello"})
    state=transition(state,{"type":"answer","branchId":branch,"text":"answer"})
    assert state["branches"][0]["entries"][-1]["text"] == "answer"
