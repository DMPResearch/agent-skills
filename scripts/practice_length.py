"""Length applies to authored logic; repo policies are read as data, never run."""
import ast
import fnmatch
import json
import pathlib
import re


def read_policy(root, config):
    spec=config.get('length_policy',{})
    policy={'max':config.get('max_code_lines',500),'exempt':[],'legacy':{},'sources':[]}
    def read(relative):
        path=root/relative
        if path.is_symlink() or not path.resolve().is_relative_to(root.resolve()) or path.stat().st_size>1000000:
            raise ValueError('Unsafe length policy path')
        policy['sources'].append(relative)
        return path.read_text()
    if spec.get('exemptions_source'):
        text=read(spec['exemptions_source'])
        block=re.search(r'const\s+EXEMPT\s*=\s*\[([\s\S]*?)\];',text)
        maximum=re.search(r'(?:export\s+)?const\s+MAX_LINES\s*=\s*(\d+)',text)
        extensions=re.search(r'const\s+EXTENSIONS\s*=\s*(\[[^\]]*\])',text)
        if not block or not maximum or not extensions: raise ValueError('Unsupported JS length-policy data format')
        policy['max']=int(maximum[1]);policy['extensions']=ast.literal_eval(extensions[1])
        for line in block[1].splitlines():
            line=line.strip()
            if not line or line.startswith('//'): continue
            match=re.fullmatch(r'/((?:\\.|[^/\\])*)/([im]*)\s*,?\s*',line)
            if not match: raise ValueError('Unsupported exemption expression; no repo code executed')
            policy['exempt'].append(re.compile(match[1].replace(r'\/', '/'),re.I if 'i' in match[2] else 0))
    if spec.get('legacy'):
        policy['legacy']=json.loads(read(spec['legacy']))
        if not isinstance(policy['legacy'],dict) or any(not isinstance(n,int) or n<0 for n in policy['legacy'].values()):
            raise ValueError('Invalid legacy line budgets')
    return policy


def data_module(name, text, config, masked=None):
    path=pathlib.Path(name)
    if any(fnmatch.fnmatch(name,g) for g in config.get('length_data_globs',[])): return True
    if path.suffix.lower() in {'.json','.jsonl','.yaml','.yml','.toml','.ini','.lock'}: return True
    if path.suffix in {'.css','.scss'} and re.search(r'(^|[/_.-])(tokens?|themes?)([/_.-]|$)',name,re.I): return True
    if path.suffix=='.py':
        try:
            tree=ast.parse(text)
            for item in tree.body:
                if isinstance(item,(ast.Import,ast.ImportFrom)): continue
                value=item.value if isinstance(item,(ast.Assign,ast.AnnAssign,ast.Expr)) else None
                if value is None: return False
                ast.literal_eval(value)
            return bool(tree.body)
        except (SyntaxError,ValueError,TypeError): return False
    if path.suffix in {'.ts','.js','.mjs','.cjs'}:
        # A literal-only exported dictionary/array is data, including locale files.
        if masked is None: return False
        if re.search(r'=>|\b(function|class|return|if|for|while|new|switch|throw)\b',masked): return False
        literal_export=bool(re.search(r'(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*[\[{]|export\s+default\s*[\[{]',masked))
        remainder=re.sub(r'\bimport\b[^;\n]*[;\n]', '', masked)
        remainder=re.sub(r'\b(?:export\s+)?(?:const|let|var)\s+\w+\s*=', '', remainder)
        remainder=re.sub(r'\bexport\s+default\b|\bas\s+const\b|\bObject\.freeze\b', '', remainder)
        remainder=re.sub(r'\b[A-Za-z_$][\w$]*\s*:', ':', remainder)
        remainder=re.sub(r'\b(?:true|false|null)\b|(?<![\w$])[-+]?\d+(?:\.\d+)?', '', remainder)
        # Reject references, assignments and computations that are not literal data.
        return literal_export and not re.search(r'[^\s{}\[\]():,;]', remainder)

    return False


def justification(name, text):
    """Only an actual file comment in the first ten lines may request ENG-002."""
    suffix=pathlib.Path(name).suffix.lower();in_block=False;markers=[]
    for number,line in enumerate(text.splitlines()[:10],1):
        stripped=line.strip();comment=None
        if suffix in {'.py','.sh','.bash','.rb'} and stripped.startswith('#'): comment=stripped[1:]
        elif suffix in {'.ts','.tsx','.js','.jsx','.mjs','.cjs','.swift','.go','.rs','.kt','.java','.c','.cpp','.h'} and stripped.startswith('//'): comment=stripped[2:]
        elif suffix in {'.ts','.tsx','.js','.jsx','.mjs','.cjs','.swift','.css','.scss','.c','.cpp','.h'}:
            if stripped.startswith('/*'): in_block=True;stripped=stripped[2:]
            if in_block:
                comment=stripped.split('*/',1)[0].lstrip('* ')
                if '*/' in stripped: in_block=False
        if suffix in {'.html','.vue','.svelte'} and stripped.startswith('<!--'):
            comment=stripped[4:].split('-->',1)[0].strip()
        if comment is not None and 'practice-allow:' in comment:
            markers.append((number,comment.strip()))
    if not markers: return None,None
    if len(markers)!=1: return None,'Use one file-level length justification'
    number,comment=markers[0]
    match=re.fullmatch(r'practice-allow:\s*(\S+)\s+because\s+(.+)',comment)
    if not match or match[1]!='ENG-002': return None,'Only ENG-002 with a written reason may be justified'
    reason=match[2].strip();words=re.findall(r'[A-Za-z][A-Za-z-]+',reason)
    if len(reason)<40 or len(words)<8 or len(set(w.lower() for w in words))<5:
        return None,'Reason must have substance: at least 40 characters and eight words'
    return {'file':name,'line':number,'rule_id':'ENG-002','reason':reason,'review':'required'},None
