#!/usr/bin/env python3
"""Build the Field Ops EN/HI/TE catalogues for the app and validate them.

Sources (both are review sheets for native speakers):
  * ../../../../../design/i18n/strings.tsv  - design kit base strings (read-only here; owned by the design workstream)
  * strings.g5.tsv                           - G5 care/sync strings (key, en, hi, te, context, review)
Output: locales/{en,hi,te}.json (nested, i18next-compatible) and locales/review.json (review status per key).
Checks: no duplicate keys across sources, no empty values, identical {{placeholders}} and <b> tags in every language,
Hindi in Devanagari, Telugu in Telugu script, no Indic text in English, length warnings (>1.6x English).
Usage: python3 build_i18n.py   (exit 1 on any error)
"""
import csv, json, re, sys, pathlib

here = pathlib.Path(__file__).resolve().parent
base_path = here.parents[3] / '..' / 'design' / 'i18n' / 'strings.tsv'
base_path = base_path.resolve()
LOCALES = ['en', 'hi', 'te']
SCRIPT = {'hi': re.compile('[ऀ-ॿ]'), 'te': re.compile('[ఀ-౿]')}
PH = re.compile(r'\{\{\s*(\w+)\s*\}\}')
TAG = re.compile(r'</?b>')

def load(path, source, default_review):
    rows = list(csv.DictReader(open(path, encoding='utf-8'), delimiter='\t'))
    for r in rows:
        r['_source'] = source
        r['review'] = (r.get('review') or default_review).strip()
    return rows

rows = load(base_path, 'design/i18n/strings.tsv', 'needs-native-review (design draft, not reviewed)') if base_path.exists() else []
rows += load(here / 'strings.g5.tsv', 'strings.g5.tsv', 'needs-native-review')
errors, warnings, seen = [], [], set()
if not base_path.exists():
    warnings.append(f'design base catalogue not found at {base_path}; building G5 strings only')
for r in rows:
    k = r['key']
    if k in seen: errors.append(f'duplicate key {k}')
    seen.add(k)
    base_ph = sorted(PH.findall(r['en'])); base_tags = TAG.findall(r['en'])
    if re.search('[ऀ-ॿఀ-౿]', r['en']): errors.append(f'{k}: Indic text in en column')
    for loc in LOCALES:
        v = (r.get(loc) or '').strip()
        if not v: errors.append(f'{k}: empty {loc}'); continue
        if sorted(PH.findall(v)) != base_ph: errors.append(f'{k}: placeholder mismatch in {loc}: {PH.findall(v)} vs {base_ph}')
        if TAG.findall(v) != base_tags: errors.append(f'{k}: <b> tag mismatch in {loc}')
        if loc in SCRIPT:
            letters = PH.sub('', TAG.sub('', v))
            if not SCRIPT[loc].search(letters) and not re.fullmatch(r'[\W\dA-Z]*', letters):
                errors.append(f'{k}: {loc} has no {loc} script characters')
            en_len = len(PH.sub('', TAG.sub('', r['en'])))
            ratio = len(letters) / max(1, en_len)
            if ratio > 1.6 and len(letters) > 8:
                warnings.append(f'{k}: {loc} is {ratio:.1f}x English length - check layout at large text sizes')

def nest(loc):
    out = {}
    for r in rows:
        node = out; parts = r['key'].split('.')
        for p in parts[:-1]:
            node = node.setdefault(p, {})
            if not isinstance(node, dict): errors.append(f'{r["key"]}: collides with a leaf'); break
        else:
            if parts[-1] in node: errors.append(f'{r["key"]}: leaf collides with a group')
            node[parts[-1]] = r[loc].strip()
    return out

out_dir = here / 'locales'
out_dir.mkdir(exist_ok=True)
if not errors:
    for loc in LOCALES:
        (out_dir / f'{loc}.json').write_text(json.dumps(nest(loc), ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    review = {r['key']: {'review': r['review'], 'source': r['_source'], 'context': r.get('context', '')} for r in rows}
    (out_dir / 'review.json').write_text(json.dumps(review, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(f'{len(rows)} keys x {len(LOCALES)} locales ({sum(1 for r in rows if r["_source"] == "strings.g5.tsv")} from G5)')
print(f'{sum(1 for r in rows if r["review"].startswith("needs"))} keys need native-speaker review')
for w in warnings: print('WARN', w)
for e in errors: print('ERROR', e)
print('OK' if not errors else f'{len(errors)} error(s)')
sys.exit(1 if errors else 0)
