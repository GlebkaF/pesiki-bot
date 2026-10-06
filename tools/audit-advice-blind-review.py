"""Join a private advice journal with a blind review; emit no player identities.
Usage: python3 tools/audit-advice-blind-review.py JOURNAL REVIEW OUTPUT
Membership is diagnostic only: conditional reviewer alternatives are not gold labels.
"""
import json
import re
import sys
from pathlib import Path

journal = json.loads(Path(sys.argv[1]).read_text())
review = json.loads(Path(sys.argv[2]).read_text())
recipes = set(re.findall(r'"key": "([a-z_]+)"', Path('src/advice-recipes.ts').read_text()))
prepared = [r for r in journal if r['kind'] == 'prepared']
judgments = {(r['window_id'], r['hero']): r for r in review['judgments']}
rows = []
for index, event in enumerate(prepared, 1):
    context = event['data']['context']
    related = [r for r in journal if r['decisionId'] == event['decisionId']]
    generated = next((r['data']['output'] for r in related if r['kind'] == 'generated'), None)
    returned = next((r['data']['state'] for r in related if r['kind'] == 'returned'), None)
    for player in context['players']:
        judgment = judgments[(f'window-{index}', player['hero'])]
        selected = next((r for r in (generated or {}).get('players', []) if r['account'] == player['account']), None)
        item = next((c for c in player['candidates'] if selected and c['id'] == selected['itemId']), None)
        assert selected is None or item is not None, 'Selected item missing from recorded input'
        returned_cards = (returned or {}).get('advice', {}).get('cards', [])
        alternatives = judgment['acceptable_next_major_item_keys']
        rows.append({
            'window': index, 'gameTime': context['gameTime'], 'hero': player['hero'],
            'engine': event['data']['engine'],
            'generatedItem': item['key'] if item else None,
            'returnedByService': any(c['account'] == player['account'] for c in returned_cards),
            'returnedState': (returned or {}).get('status'),
            'conditionalReviewerAlternatives': alternatives,
            'generatedInConditionalUnion': item['key'] in alternatives if item else None,
            'reviewerPrefersDeferringMajorChoice': judgment['prefer_not_to_select_major_now'],
            'absentFromCurrentRecipeLibrary': sorted(set(alternatives) - recipes),
            'reviewerRationale': judgment['rationale'],
        })
assert len(rows) == len(judgments), 'Every reviewed decision must be joined'
report = {
    'scope': '7 dependent windows from one Turbo match; historical engines, not current-version quality',
    'limits': ['Automated reviewer, not human expert', 'Conditional unions are not gold labels',
               'Non-membership does not prove a bad choice; membership does not prove a good one',
               'Service return does not prove browser delivery or player benefit',
               'Recipe absence measures library coverage, not availability after eligibility gates'],
    'summary': {'decisions': len(rows), 'generated': sum(r['generatedItem'] is not None for r in rows),
                'returnedByService': sum(r['returnedByService'] for r in rows),
                'generatedInConditionalUnion': sum(r['generatedInConditionalUnion'] is True for r in rows),
                'reviewerPrefersDeferringMajorChoice': sum(r['reviewerPrefersDeferringMajorChoice'] for r in rows),
                'missingRecipeKeys': sorted({k for r in rows for k in r['absentFromCurrentRecipeLibrary']})},
    'rows': rows,
}
Path(sys.argv[3]).write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(report['summary'], ensure_ascii=False))
