#!/usr/bin/env python3
"""Shortcut:  python run.py [--lan] [--port 8000]   (same as: python -m khmer_studio)"""
import sys

from khmer_studio.__main__ import main

if __name__ == "__main__":
    sys.exit(main())
