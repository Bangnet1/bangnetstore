import re, sys
from html.parser import HTMLParser
from pathlib import Path

class Check(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids=[]
        self.scripts=[]
        self.capture=False
        self.current=[]
    def handle_starttag(self, tag, attrs):
        a=dict(attrs)
        if 'id' in a: self.ids.append(a['id'])
        if tag=='script' and a.get('type')=='module':
            self.capture=True
            self.current=[]
    def handle_endtag(self, tag):
        if tag=='script' and self.capture:
            self.scripts.append(''.join(self.current))
            self.capture=False
    def handle_data(self, data):
        if self.capture: self.current.append(data)

p=Path('manager.html')
parser=Check()
parser.feed(p.read_text(encoding='utf-8'))
duplicates=sorted({x for x in parser.ids if parser.ids.count(x)>1})
if duplicates:
    print('Duplicate HTML IDs:', ', '.join(duplicates))
    sys.exit(1)
if len(parser.scripts)!=1:
    print('Expected exactly one inline module script; found',len(parser.scripts))
    sys.exit(1)
Path('/tmp/manager-check.mjs').write_text(parser.scripts[0],encoding='utf-8')
print('HTML IDs unique; inline module extracted.')
