"""
sitecustomize hook — auto-imported by Python at interpreter startup
when found anywhere on sys.path. We use it to monkey-patch
terminal-bench's Windows-vs-Linux path mismatch BEFORE the harness
runs, so the patches are in place no matter how the harness is
invoked.

Core problem: terminal-bench uses `pathlib.Path(...)` for IN-CONTAINER
paths. On Windows hosts that becomes `WindowsPath` which str()s with
backslashes — those then get passed to the Linux container's
Docker API and bash, neither of which know what to do with
`\logs\agent.cast` or `\tmp`.

Patches applied (Windows hosts only):

  1. `Path.__str__` is monkey-patched at the class level to return
     a forward-slash form ONLY when the stringified path looks
     container-bound (starts with what would be Linux-style absolute
     paths). This catches the asciinema rec command, run-tests.sh
     path, and any other `f"…{path}"` interpolation.

  2. `DockerComposeManager.copy_to_container` normalizes its
     container_dir arg to forward slashes before calling the Docker
     API.

These patches are no-ops on Linux/Mac hosts (sys.platform check).
"""
import sys


# Paths that "look" container-bound — start with one of these AFTER
# the drive-letter-ish prefix is stripped. We use this to decide
# whether to force forward slashes when str()ing a WindowsPath.
_CONTAINER_PATH_PREFIXES = (
    "/tmp",
    "/logs",
    "/tests",
    "/app",
    "/installed-agent",
    "/oracle",
    "/agent-output",
    "/var",
    "/etc",
    "/usr",
    "/opt",
    "/root",
    "/home",
)


def _patch_terminal_bench():
    if sys.platform != "win32":
        return
    try:
        from terminal_bench.terminal import docker_compose_manager as dcm
    except ImportError:
        return

    # ── Patch 1: copy_to_container container_dir normalization ──
    _original_copy_to_container = dcm.DockerComposeManager.copy_to_container

    def _posix_safe_copy_to_container(
        cls,
        container,
        paths,
        container_dir=None,
        container_filename=None,
    ):
        if isinstance(container_dir, str):
            container_dir = container_dir.replace("\\", "/")
        return _original_copy_to_container(
            container,
            paths,
            container_dir=container_dir,
            container_filename=container_filename,
        )

    dcm.DockerComposeManager.copy_to_container = classmethod(
        _posix_safe_copy_to_container
    )

    # ── Patch 2: WindowsPath.__str__ returns posix form for paths
    # that look container-bound. ──
    #
    # WindowsPath inherits from PurePath; we wrap __str__ to detect
    # paths starting with a known Linux-side prefix (after the leading
    # backslash) and return them as forward-slash strings instead.
    # All other WindowsPath usage (host-side files, log dirs, etc.)
    # falls through to the original behavior unchanged.
    from pathlib import WindowsPath, PureWindowsPath

    _original_winpath_str = PureWindowsPath.__str__

    def _posix_str(self):
        result = _original_winpath_str(self)
        # Looks like a Linux absolute path that pathlib has mangled?
        forward = result.replace("\\", "/")
        if forward.startswith(_CONTAINER_PATH_PREFIXES):
            return forward
        # Looks like a Linux home directory path?
        if forward.startswith("/root/") or forward == "/root":
            return forward
        return result

    PureWindowsPath.__str__ = _posix_str
    WindowsPath.__str__ = _posix_str


_patch_terminal_bench()
