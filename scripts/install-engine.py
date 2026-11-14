import io
import pathlib
import platform
import tarfile
import urllib.request

systems = {'Darwin': 'Darwin', 'Linux': 'Linux', 'Windows': 'Windows'}
arches = {'arm64': 'arm64', 'aarch64': 'arm64', 'x86_64': 'x86_64', 'AMD64': 'x86_64'}
system = systems[platform.system()]
arch = arches[platform.machine()]
url = f'https://github.com/BattlesnakeOfficial/rules/releases/download/v1.2.3/battlesnake_1.2.3_{system}_{arch}.tar.gz'
name = 'battlesnake.exe' if system == 'Windows' else 'battlesnake'
with urllib.request.urlopen(url) as response:
    data = response.read()
with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
    member = next(m for m in archive.getmembers() if pathlib.PurePosixPath(m.name).name == name and m.isfile())
    content = archive.extractfile(member).read()
path = pathlib.Path('tools') / name
path.parent.mkdir(exist_ok=True)
path.write_bytes(content)
path.chmod(0o755)
print(path)
