"""Check the staging permission fix against unsafe Windows-derived modes."""
from pathlib import Path
import ast,stat,tempfile
source=Path(__file__).resolve().parents[1]/'scripts/prepare-rootfs.py'
tree=ast.parse(source.read_text(encoding='utf-8'))
function=next(node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name=='normalize_rpc_permissions')
namespace={};exec(compile(ast.Module(body=[function],type_ignores=[]),str(source),'exec'),namespace)
with tempfile.TemporaryDirectory() as temp:
    root=Path(temp)
    for folder in ['usr/share/rpcd/ucode','usr/share/rpcd/acl.d']:
        directory=root/folder;directory.mkdir(parents=True)
        for mode in [0o666,0o777,0o644]:
            path=directory/str(mode);path.write_bytes(b'unchanged payload');path.chmod(mode)
    namespace['normalize_rpc_permissions'](root)
    for path in root.rglob('*'):
        if path.is_file():
            assert stat.S_IMODE(path.stat().st_mode)==0o644,path
            assert path.read_bytes()==b'unchanged payload'
    assert any(isinstance(node,ast.Expr) and isinstance(node.value,ast.Call) and isinstance(node.value.func,ast.Name) and node.value.func.id=='normalize_rpc_permissions' for node in tree.body)
    print('PASS staging: unsafe ucode/ACL modes become 0644 without modifying payload bytes.')
