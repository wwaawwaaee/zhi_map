def utf16_length(value: str) -> int:
    """JavaScript string length, expressed in UTF-16 code units."""
    return len(value.encode("utf-16-le")) // 2


def utf16_slice(value: str, start: int, end: int | None = None) -> str:
    units = value.encode("utf-16-le")
    end = utf16_length(value) if end is None else end
    if start < 0 or end < start or end > len(units) // 2:
        raise ValueError("UTF-16 range is invalid")
    try:
        return units[start * 2 : end * 2].decode("utf-16-le")
    except UnicodeDecodeError as error:
        raise ValueError("UTF-16 range splits a surrogate pair") from error
