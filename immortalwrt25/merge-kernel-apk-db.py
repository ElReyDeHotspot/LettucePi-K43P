#!/usr/bin/env python3
"""Keep Chester userspace records but replace kernel/kmod records with base records."""

import pathlib
import sys


def records(path: str) -> list[str]:
    text = pathlib.Path(path).read_text(encoding="utf-8")
    return [record for record in text.strip().split("\n\n") if record.strip()]


def package_name(record: str) -> str:
    for line in record.splitlines():
        if line.startswith("P:"):
            return line[2:]
    return ""


def kernel_record(record: str) -> bool:
    name = package_name(record)
    return name == "kernel" or name.startswith("kmod-")


if len(sys.argv) != 4:
    raise SystemExit("usage: merge-kernel-apk-db.py BASE_DB CHESTER_DB OUTPUT")

base = records(sys.argv[1])
chester = records(sys.argv[2])
merged = [record for record in chester if not kernel_record(record)]
merged.extend(record for record in base if kernel_record(record))
merged.sort(key=package_name)
pathlib.Path(sys.argv[3]).write_text("\n\n".join(merged) + "\n\n", encoding="utf-8")

base_kernel = {package_name(record) for record in base if kernel_record(record)}
output_kernel = {package_name(record) for record in merged if kernel_record(record)}
if output_kernel != base_kernel:
    raise SystemExit("kernel package database merge failed")
print(f"kernel records from base: {len(base_kernel)}")
print(f"Chester userspace records retained: {len(merged) - len(base_kernel)}")
