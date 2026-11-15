"""Build verified, reproducible Bedrock and distribution archives using the standard library."""
import hashlib
import json
import sys
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parents[1]
ZIP_DATE = (2026, 11, 8, 0, 0, 0)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def write_archive(destination, entries):
    """Replace a complete archive only after CRC and every entry have been verified."""
    temporary = destination.with_suffix(destination.suffix + ".tmp")
    try:
        with ZipFile(temporary, "w", compression=ZIP_DEFLATED, compresslevel=9) as archive:
            for name, content in sorted(entries.items()):
                info = ZipInfo(name, date_time=ZIP_DATE)
                info.compress_type = ZIP_DEFLATED
                info.create_system = 3
                info.external_attr = 0o644 << 16
                archive.writestr(info, content, compress_type=ZIP_DEFLATED, compresslevel=9)
        with ZipFile(temporary) as archive:
            if archive.testzip() is not None or set(archive.namelist()) != set(entries):
                raise ValueError("Archive CRC or entry list verification failed")
            for name, content in entries.items():
                if archive.read(name) != content:
                    raise ValueError(f"Archive content mismatch: {name}")
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)


def build(root=ROOT):
    version = json.loads((root / "package.json").read_text(encoding="utf-8"))["version"]
    expected_version = [int(part) for part in version.split(".")]
    manifests = [json.loads((root / "packs" / pack / "manifest.json").read_text(encoding="utf-8"))
                 for pack in ("AdminTools BP", "AdminTools RP")]
    for manifest, peer in zip(manifests, reversed(manifests)):
        versions = [manifest["header"]["version"], *[m["version"] for m in manifest["modules"]]]
        versions += [d["version"] for d in manifest["dependencies"] if d.get("uuid") == peer["header"]["uuid"]]
        if len(versions) != len(manifest["modules"]) + 2 or any(v != expected_version for v in versions):
            raise ValueError("Package and pack versions differ; run npm run version:sync")
    dest = root / "dist"
    dest.mkdir(exist_ok=True)
    addon = dest / f"Admin-Tools-XA-{version}.mcaddon"
    entries = {p.relative_to(root / "packs").as_posix(): p.read_bytes()
               for p in (root / "packs").rglob("*") if p.is_file() and not p.name.endswith(".test.mjs")}
    write_archive(addon, entries)
    distribution = dest / f"Admin-Tools-XA-{version}-distribution.zip"
    documents = [root / name for name in ("README.md", "CHANGELOG.md", "LICENSE.md", "NOTICE.md", "UPSTREAM.json", "SECURITY.md", "CONTRIBUTING.md")]
    documents += sorted((root / "docs").rglob("*.md"))
    release_entries = {p.relative_to(root).as_posix(): p.read_bytes() for p in documents}
    release_entries[addon.name] = addon.read_bytes()
    release_entries["SHA256SUMS.txt"] = f"{sha256(addon.read_bytes())}  {addon.name}\n".encode()
    release_entries["INSTALL.txt"] = (
        f"Admin Tools 相安版 {version}\n\n"
        f"先备份世界，导入 {addon.name}，同时启用行为包与资源包。\n"
        "专用服务器按 docs/SERVER_UPGRADE.md 更新世界绑定并正常停服重启。\n"
        "运行依赖：Minecraft 基岩版26.30或以上兼容版本、Script API server 2.8.0 / server-ui 2.1.0。\n"
        "发行包不需要安装 Node.js 或 Python；开发请克隆 README 中的 GitHub 仓库。\n"
        "保留原 UUID；回滚需恢复升级前的世界及两包备份。\n"
        "维护者：相安 <3199912548@qq.com>；原作：JM_Addons / JM。\n"
        "授权状态见 LICENSE.md 和 NOTICE.md；上游 All Rights Reserved，未重新许可。\n"
    ).encode("utf-8")
    write_archive(distribution, release_entries)
    assets = []
    for artifact in (addon, distribution):
        assets.append({"name": artifact.name, "bytes": artifact.stat().st_size, "sha256": sha256(artifact.read_bytes())})
    checksum = "".join(f"{asset['sha256']}  {asset['name']}\n" for asset in assets)
    temporary = dest / "SHA256SUMS.txt.tmp"
    temporary.write_text(checksum, encoding="utf-8", newline="\n")
    temporary.replace(dest / "SHA256SUMS.txt")
    return {"version": version, "pack_files": len(entries), "assets": assets}


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(build(), ensure_ascii=False, indent=2))
