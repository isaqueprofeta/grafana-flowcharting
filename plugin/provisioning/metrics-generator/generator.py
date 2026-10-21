#!/usr/bin/env python3
"""
Synthetic Metrics_Generator for the FlowCharting Demo_Stack.

Exposes a Prometheus text-format /metrics endpoint describing a small infra
topology of three components -- web, app, db -- with the following series:

  up{component=...}                 1 = healthy, 0 = down
  app_request_latency_ms{component} request latency in milliseconds
  app_cpu_usage_percent{component}  CPU utilisation as a percentage (0-100)

The values are driven by time so they slowly cross the thresholds used by the
demo dashboard. Each component runs on its own sine phase so the three cells
light up green/orange/red at different moments, and once per cycle a component
is forced "down" (up == 0) so the up-based rule is exercised too.

No third-party packages are used -- the script runs on a plain python:3-slim
image with nothing to install, which keeps the Demo_Stack reproducible from the
committed files alone.
"""

import math
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = 9090

# component -> (latency phase offset, cpu phase offset) in radians.
# Different phases make the three cells change colour at different times.
COMPONENTS = {
    "web": (0.0, 0.5),
    "app": (2.0, 2.5),
    "db": (4.0, 4.5),
}

# Period (seconds) of the slow oscillation that drives threshold crossings.
PERIOD_SECONDS = 120.0

# Latency band (ms): oscillates well across the 150 / 400 thresholds.
LATENCY_BASE = 250.0
LATENCY_AMPLITUDE = 220.0

# CPU band (%): oscillates across the 60 / 85 thresholds.
CPU_BASE = 55.0
CPU_AMPLITUDE = 40.0


def _wave(phase: float) -> float:
    """Return a sine value in [0, 1] for the current time plus a phase offset."""
    t = time.time()
    angle = (2.0 * math.pi * t / PERIOD_SECONDS) + phase
    return (math.sin(angle) + 1.0) / 2.0


def _is_down(component: str) -> bool:
    """Force each component down for a short slice once per period.

    The three down windows are staggered so only one component is down at a
    time, and never for long, which keeps the demo readable.
    """
    t = time.time()
    cycle = t % PERIOD_SECONDS
    windows = {
        "web": (10.0, 18.0),
        "app": (50.0, 58.0),
        "db": (90.0, 98.0),
    }
    start, end = windows[component]
    return start <= cycle < end


def render_metrics() -> str:
    lines = []

    lines.append("# HELP up Whether the component is reachable (1) or down (0).")
    lines.append("# TYPE up gauge")
    for component in COMPONENTS:
        value = 0 if _is_down(component) else 1
        lines.append('up{{component="{0}"}} {1}'.format(component, value))

    lines.append(
        "# HELP app_request_latency_ms Synthetic request latency in milliseconds."
    )
    lines.append("# TYPE app_request_latency_ms gauge")
    for component, (lat_phase, _cpu_phase) in COMPONENTS.items():
        if _is_down(component):
            latency = 0.0
        else:
            latency = LATENCY_BASE + LATENCY_AMPLITUDE * (2.0 * _wave(lat_phase) - 1.0)
        lines.append(
            'app_request_latency_ms{{component="{0}"}} {1:.2f}'.format(
                component, latency
            )
        )

    lines.append("# HELP app_cpu_usage_percent Synthetic CPU usage percentage.")
    lines.append("# TYPE app_cpu_usage_percent gauge")
    for component, (_lat_phase, cpu_phase) in COMPONENTS.items():
        if _is_down(component):
            cpu = 0.0
        else:
            cpu = CPU_BASE + CPU_AMPLITUDE * (2.0 * _wave(cpu_phase) - 1.0)
            cpu = max(0.0, min(100.0, cpu))
        lines.append(
            'app_cpu_usage_percent{{component="{0}"}} {1:.2f}'.format(component, cpu)
        )

    return "\n".join(lines) + "\n"


class MetricsHandler(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802 (name mandated by BaseHTTPRequestHandler)
        if self.path in ("/metrics", "/"):
            body = render_metrics().encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; version=0.0.4")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, *_args):
        # Silence per-request logging; Prometheus scrapes once a second.
        return


def main():
    server = ThreadingHTTPServer(("0.0.0.0", PORT), MetricsHandler)
    print("metrics-generator listening on :{0}/metrics".format(PORT), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
