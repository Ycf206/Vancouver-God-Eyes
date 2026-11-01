#!/usr/bin/env python3
"""
Alias wrapper for Vancouver Banks / ATM updater (delegates to update_banks.py).
"""

import os
import sys

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if CURRENT_DIR not in sys.path:
    sys.path.insert(0, CURRENT_DIR)

from update_banks import update_atm_dataset, update_banks, update_atm  # noqa: F401

if __name__ == '__main__':
    update_atm_dataset()
