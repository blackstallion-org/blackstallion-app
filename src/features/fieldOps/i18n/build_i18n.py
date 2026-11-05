#!/usr/bin/env python3
"""Build the Field Ops FO-08..FO-20 catalogues (fo.* namespace) and validate them.

Source: strings.fo.tsv (key, en, hi, te, context). Hindi and Telugu are a machine-assisted first draft; every key is
recorded in locales/review.json as needing native-speaker review. Same checks as features/care/i18n/build_i18n.py:
no duplicate keys, no empty values, identical {{placeholders}} in every language, Hindi in Devanagari, Telugu in
Telugu script, no Indic text in English, length warnings (>1.6x English).
Usage: python3 build_i18n.py   (exit 1 on any error)
"""
import csv, json, re, sys, pathlib

here = pathlib.Path(__file__).resolve().parent
LOCALES = ['en', 'hi', 'te']
SCRIPT = {'hi': re.compile('[ऀ-ॿ]'), 'te': re.compile('[ఀ-౿]')}
PH = re.compile(r'\{\{\s*(\w+)\s*\}\}')
rows = list(csv.DictReader(open(here / 'strings.fo.tsv', encoding='utf-8'), delimiter='\t', quoting=csv.QUOTE_NONE))
errors, warnings, seen = [], [], set()
for r in rows:
    k = r['key']
    if not k.startswith('fo.'): errors.append(f'{k}: outside the fo.* namespace')
    if k in seen: errors.append(f'duplicate key {k}')
    seen.add(k)
    base_ph = sorted(PH.findall(r['en']))
    if re.search('[ऀ-ॿఀ-౿]', r['en']): errors.append(f'{k}: Indic text in en column')
    for loc in LOCALES:
        v = (r.get(loc) or '').strip()
        if not v: errors.append(f'{k}: empty {loc}'); continue
        if sorted(PH.findall(v)) != base_ph: errors.append(f'{k}: placeholder mismatch in {loc}')
        if loc in SCRIPT:
            letters = PH.sub('', v)
            if not SCRIPT[loc].search(letters) and not re.fullmatch(r'[\W\dA-Z]*', letters):
                errors.append(f'{k}: {loc} has no {loc} script characters')
            ratio = len(letters) / max(1, len(PH.sub('', r['en'])))
            if ratio > 1.6 and len(letters) > 8:
                warnings.append(f'{k}: {loc} is {ratio:.1f}x English length')

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

built = {loc: nest(loc) for loc in LOCALES}
if not errors:
    for loc in LOCALES:
        (here / 'locales' / f'{loc}.json').write_text(json.dumps(built[loc], ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    review = {r['key']: {'review': 'needs-native-review (machine-assisted draft)', 'source': 'strings.fo.tsv', 'context': r.get('context', '')} for r in rows}
    (here / 'locales' / 'review.json').write_text(json.dumps(review, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(f'{len(rows)} keys x {len(LOCALES)} locales; all {len(rows)} need native-speaker review')
for w in warnings: print('WARN', w)
for e in errors: print('ERROR', e)
print('OK' if not errors else f'{len(errors)} error(s)')
sys.exit(1 if errors else 0)
