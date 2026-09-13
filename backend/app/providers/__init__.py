"""Independent text protocol adapters and bounded streaming transport."""

from .gateway import ChatRequest, GatewayError, events, complete

__all__ = ["ChatRequest", "GatewayError", "events", "complete"]
