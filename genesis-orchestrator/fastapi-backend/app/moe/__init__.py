"""Mixture-of-Experts (MOE) dynamic loader.

E-Mobility controller protocols (VESC, Ninebot/Xiaomi UART, ...) can be loaded
at runtime — either from a GitHub Release asset or from an S3 bucket — without
restarting the backend. See `loader.py` and `registry.py`.
"""
