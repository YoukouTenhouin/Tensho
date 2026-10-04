"""XTest input for disposable X11 acceptance sessions; never opens a display implicitly."""
import ctypes
import time


def connection(display):
    x = ctypes.CDLL('libX11.so.6'); t = ctypes.CDLL('libXtst.so.6')
    x.XOpenDisplay.argtypes = [ctypes.c_char_p]; x.XOpenDisplay.restype = ctypes.c_void_p
    x.XFlush.argtypes = [ctypes.c_void_p]; x.XCloseDisplay.argtypes = [ctypes.c_void_p]
    handle = x.XOpenDisplay(display.encode())
    if not handle:
        raise RuntimeError('Cannot open acceptance display')
    return x, t, handle


def click(display, a, b, button=1):
    x, t, d = connection(display)
    try:
        t.XTestFakeMotionEvent.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_ulong]
        t.XTestFakeButtonEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
        t.XTestFakeMotionEvent(d, -1, a, b, 0); x.XFlush(d)
        time.sleep(.05)
        t.XTestFakeButtonEvent(d, button, 1, 0); x.XFlush(d)
        time.sleep(.03)
        t.XTestFakeButtonEvent(d, button, 0, 0); x.XFlush(d)
    finally:
        x.XCloseDisplay(d)


def key(display, *names):
    x, t, d = connection(display)
    try:
        x.XStringToKeysym.argtypes = [ctypes.c_char_p]; x.XStringToKeysym.restype = ctypes.c_ulong
        x.XKeysymToKeycode.argtypes = [ctypes.c_void_p, ctypes.c_ulong]; x.XKeysymToKeycode.restype = ctypes.c_uint
        t.XTestFakeKeyEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
        codes = [x.XKeysymToKeycode(d, x.XStringToKeysym(n.encode())) for n in names]
        if not all(codes):
            raise RuntimeError('Unknown native key')
        for code in codes: t.XTestFakeKeyEvent(d, code, 1, 0)
        for code in reversed(codes): t.XTestFakeKeyEvent(d, code, 0, 0)
        x.XFlush(d)
    finally:
        x.XCloseDisplay(d)
