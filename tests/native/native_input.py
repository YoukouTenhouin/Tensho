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


def click(display, a, b, button=1, window=None):
    x, t, d = connection(display)
    try:
        t.XTestFakeMotionEvent.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_ulong]
        t.XTestFakeButtonEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
        if window is None:
            t.XTestFakeMotionEvent(d, -1, a, b, 0)
        else:
            x.XWarpPointer.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_int, ctypes.c_int, ctypes.c_uint, ctypes.c_uint, ctypes.c_int, ctypes.c_int]
            x.XWarpPointer(d, 0, window, 0, 0, 0, 0, a, b)
        x.XFlush(d)
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
        for code in codes:
            t.XTestFakeKeyEvent(d, code, 1, 0); x.XFlush(d); time.sleep(.03)
        for code in reversed(codes):
            t.XTestFakeKeyEvent(d, code, 0, 0); x.XFlush(d); time.sleep(.03)
        x.XFlush(d)
    finally:
        x.XCloseDisplay(d)


def window_geometry(display, window):
    x, _t, d = connection(display)
    try:
        root = ctypes.c_ulong(); child = ctypes.c_ulong()
        a = ctypes.c_int(); b = ctypes.c_int()
        width = ctypes.c_uint(); height = ctypes.c_uint(); border = ctypes.c_uint(); depth = ctypes.c_uint()
        x.XGetGeometry.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_uint), ctypes.POINTER(ctypes.c_uint), ctypes.POINTER(ctypes.c_uint), ctypes.POINTER(ctypes.c_uint)]
        x.XTranslateCoordinates.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_int, ctypes.c_int, ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_ulong)]
        if not x.XGetGeometry(d, window, ctypes.byref(root), ctypes.byref(a), ctypes.byref(b), ctypes.byref(width), ctypes.byref(height), ctypes.byref(border), ctypes.byref(depth)):
            raise RuntimeError('Cannot read disposable window geometry')
        if not x.XTranslateCoordinates(d, window, root.value, 0, 0, ctypes.byref(a), ctypes.byref(b), ctypes.byref(child)):
            raise RuntimeError('Cannot translate disposable window coordinates')
        return {'x': a.value, 'y': b.value, 'width': width.value, 'height': height.value}
    finally:
        x.XCloseDisplay(d)


def focus_window(display, window):
    x, _t, d = connection(display)
    try:
        x.XSetInputFocus.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_int, ctypes.c_ulong]
        x.XSetInputFocus(d, window, 2, 0)
        x.XFlush(d)
    finally:
        x.XCloseDisplay(d)
