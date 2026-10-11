"""新舊 audit.json 的可見文字比對（多重集合）。用法：python textdiff.py <舊.audit.json> <新.audit.json>"""
import json, sys
from collections import Counter
a = Counter(json.load(open(sys.argv[1], encoding="utf-8"))["texts"])
b = Counter(json.load(open(sys.argv[2], encoding="utf-8"))["texts"])
only_old, only_new = a - b, b - a
print(f"舊 {sum(a.values())} 筆／新 {sum(b.values())} 筆")
print("只在舊版：", dict(only_old) or "無")
print("只在新版：", dict(only_new) or "無")
sys.exit(1 if only_old or only_new else 0)
