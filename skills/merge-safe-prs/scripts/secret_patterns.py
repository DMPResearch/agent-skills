"""Shared credential recognition; never reads files or emits values."""
import math
import re

PATH_RE = re.compile(r"""(?ix)
    (^|/)(\.ssh|\.?private_keys|\.gnupg|keychains?)/
  | (^|/)\.env(rc|\.(?!example$|sample$|template$|dist$)[^/]*)?$
  | (^|/)id_(rsa|ed25519|ecdsa|dsa)[^/]*$
  | \.(pem|p8|p12|pfx|key|keystore|jks|mobileprovision|kdbx|der|bks|ppk|asc|gpg)$
  | (service[-_]?account|adminsdk|credentials?|secrets?)[^/]*\.(json|ya?ml|txt|plist)$
""")

# A literal value, not a reference to one: skip env lookups and placeholders.
PLACEHOLDER = re.compile(r"""(?ix)^(
     \$\{?[A-Z_][A-Z0-9_]*\}?            # $VAR, ${VAR}
   | (process\.env|os\.environ|import\.meta\.env)\b.*
   | (os\.)?getenv\b.* | env\(.*
   | <[^>]*>                           # <your-key>
   | (?-i:(your|example|sample|changeme|dummy|placeholder|redacted|test|fake)([-_.][a-z]{1,12}){0,3}([-_.]?\d{1,4})?)  # lowercase words, short number
   | x{4,} | \*{3,}
)$""")
CONTENT = [re.compile(p) for p in (
    r"-----BEGIN [A-Z ]*PRIVATE KEY-----",
    r"\bAKIA[0-9A-Z]{16}\b",                                # AWS access key id
    r"\b(sk|rk)_(live|test)_[0-9A-Za-z]{16,}",               # Stripe secret/restricted
    r"\bwhsec_[0-9A-Za-z]{20,}",                            # Stripe webhook secret
    r"\bgh[pousr]_[0-9A-Za-z]{30,}|\bgithub_pat_[0-9A-Za-z_]{40,}",
    r"\bxox[abprs]-[0-9A-Za-z-]{10,}",                      # Slack
    r"\bAIza[0-9A-Za-z_-]{35}",                             # Google API key
    r"\bsk-(ant-|or-|proj-)?[0-9A-Za-z_-]{32,}",            # Anthropic/OpenRouter/OpenAI
    r"\"private_key\"\s*:\s*\"",                            # service-account JSON
    r"\beyJ[0-9A-Za-z_-]{20,}\.eyJ[0-9A-Za-z_-]{20,}\.[0-9A-Za-z_-]{20,}",  # JWT
    r"\b[a-z][a-z0-9+.-]*://[^\s:/@'\"]+:[^\s@/'\"]{6,}@",  # URL with a password
)]
ASSIGN = re.compile(r"""(?i)\b[A-Z0-9_.-]*(secret|token|passw(or)?d|api[_-]?key|private[_-]?key|access[_-]?key|client[_-]?secret)[A-Z0-9_.-]*['"]?\]?\s*[:=]\s*(?:"([^"\n]{12,})"|'([^'\n]{12,})'|([^\s'"#,;]{12,}))""")


SENSITIVE_NAME = re.compile(r"(?i)\b[A-Z0-9_.-]*(?:secret|token|passw(?:or)?d|api[_-]?key|private[_-]?key|access[_-]?key|client[_-]?secret)[A-Z0-9_.-]*")
STRICT_KEY = re.compile(r"(?i)(secret|passw(or)?d|api[_-]?key|private[_-]?key|access[_-]?key|client[_-]?secret)")


def looks_like_token(v, quoted=False, strict_key=False):
    """A literal secret, not code: no calls or dotted references, not a plain
    word or CONSTANT, and token-like (letters with digits, or long mixed case)."""
    if " " in v:  # prose ("At least 12 characters"), not a credential
        return False
    if not quoted and ("(" in v or v.startswith("/") or re.search(r"[\[\]^\\]", v)):
        return False
    if re.fullmatch(r'Read\((?:~?/|//|\*\*/)[^\n]*\)', v):
        return False
    if not quoted and re.fullmatch(r'[A-Za-z_$][\w$]*<[^>]+>;?', v):
        return False
    if re.fullmatch(r"[A-Za-z_$][\w$]*(\??\.[A-Za-z_$][\w$]*)+", v.rstrip(")") if not quoted else v):
        return False
    if re.fullmatch(r"[a-z_-]+|[A-Z_-]+", v):
        return False
    # Digit-free values count only for explicit secret/password/key names: under
    # "token" names they are camelCase constants ("tripActivityToken") and would
    # bury real hits.
    digitfree = strict_key and len(v) >= 16 and re.search(r"[a-z]", v) and re.search(r"[A-Z]", v)
    if not digitfree and (len(v) < 20 or not (re.search(r"[A-Za-z]", v) and re.search(r"\d", v))):
        return False
    counts = {c: v.count(c) for c in set(v)}
    entropy = -sum(n / len(v) * math.log2(n / len(v)) for n in counts.values())
    return entropy >= (3.2 if digitfree else 3.5)


KEY_PATH_TOKEN = re.compile(r"[\w.~/-]*(?:/|\.)[\w.~/-]+")


def line_hits(line, paths=False):
    """(rule, key name, value length) per hit; never the value itself.
    paths=True also flags credential-like file paths named in the text."""
    out = [(f"pattern {i}", "", 0) for i, r in enumerate(CONTENT) if r.search(line)]
    if paths and any(PATH_RE.search(t) for t in KEY_PATH_TOKEN.findall(line)):
        out.append(("credential-like path in text", "", 0))
    for m in ASSIGN.finditer(line):  # every assignment, not only the first
        v = m.group(3) or m.group(4) or m.group(5)
        quoted = m.group(5) is None
        if not PLACEHOLDER.match(v) and looks_like_token(v, quoted, bool(STRICT_KEY.search(m.group(0).split("=")[0].split(":")[0]))):
            key = re.split(r"\s*[:=]", m.group(0))[0].strip(" '\"")[-40:]
            out.append(("assignment", key, len(v)))
    # A literal fallback (process.env.API_KEY || "x", os.getenv("TOKEN", "x")):
    # judged by the nearest sensitive name before it, which owns the fallback.
    for m in re.finditer(r"""(?:\|\||\?\?|\bor\b|,)\s*['"]([^'"\s]{12,})['"]""", line):
        names = SENSITIVE_NAME.findall(line[:m.start()])
        if not names:
            continue
        strict = bool(STRICT_KEY.search(names[-1]))
        if looks_like_token(m.group(1), True, strict) and not PLACEHOLDER.match(m.group(1)):
            out.append(("fallback literal", names[-1][-40:], len(m.group(1))))
    return out



def redact(text):
    """Redact recognized credentials without retaining their values in reports."""
    for pattern in CONTENT:
        text = pattern.sub('[REDACTED]', text)
    if line_hits(text):
        return '[REDACTED: credential-like assignment]'
    return text


def strong_secret_lines(text):
    """Raw provider formats, complete key material and non-placeholder password URLs."""
    lines=set()
    for pattern in [CONTENT[i] for i in [1,2,3,4,5,6,7,9]]:
        for match in pattern.finditer(text): lines.add(text.count('\n',0,match.start())+1)
    block=re.compile(r'-----BEGIN ([A-Z ]*PRIVATE KEY)-----\s*([A-Za-z0-9+/=\s]{64,})\s*-----END \1-----')
    for match in block.finditer(text):
        if len(re.sub(r'\s','',match[2]))>=64: lines.add(text.count('\n',0,match.start())+1)
    for number,line in enumerate(text.splitlines(),1):
        decoded=line.replace('\\\"','\"').replace('\\n','\n').replace('\\r','\r')
        if block.search(decoded): lines.add(number)
        for match in CONTENT[10].finditer(decoded):
            password=match.group().split('://',1)[1].split(':',1)[1][:-1]
            if not PLACEHOLDER.fullmatch(password) and looks_like_token(password, True, True): lines.add(number)
    return lines
