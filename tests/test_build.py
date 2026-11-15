import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile

spec = importlib.util.spec_from_file_location("addon_build", Path(__file__).resolve().parents[1] / "tools/build.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class BuildTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="admin-tools-build-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        (self.root / "package.json").write_text('{"version":"1.2.3"}', encoding="utf-8")
        for pack, uuid, peer in [("AdminTools BP", "bp", "rp"), ("AdminTools RP", "rp", "bp")]:
            directory = self.root / "packs" / pack
            directory.mkdir(parents=True)
            manifest = {"header": {"uuid": uuid, "version": [1, 2, 3]}, "modules": [{"version": [1, 2, 3]}], "dependencies": [{"uuid": peer, "version": [1, 2, 3]}]}
            (directory / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
            (directory / "ignored.test.mjs").write_text("test-only", encoding="utf-8")
            (directory / "data.txt").write_bytes("真实发货内容\n".encode())
        for name in ("README.md", "CHANGELOG.md", "LICENSE.md", "NOTICE.md", "UPSTREAM.json", "SECURITY.md", "CONTRIBUTING.md"):
            (self.root / name).write_text(name, encoding="utf-8")
        (self.root / "docs").mkdir()
        (self.root / "docs/USER_GUIDE.md").write_text("usage", encoding="utf-8")

    def test_build_is_repeatable_and_distribution_includes_notices_and_exact_addon(self):
        first = builder.build(self.root)
        second = builder.build(self.root)
        self.assertEqual(first, second)
        dest = self.root / "dist"
        addon = dest / first["assets"][0]["name"]
        with ZipFile(addon) as archive:
            self.assertEqual(len(archive.namelist()), 4)
            self.assertFalse(any(name.endswith(".test.mjs") for name in archive.namelist()))
            self.assertEqual(archive.read("AdminTools BP/data.txt"), "真实发货内容\n".encode())
        with ZipFile(dest / first["assets"][1]["name"]) as archive:
            self.assertEqual(archive.read(addon.name), addon.read_bytes())
            for name in ("LICENSE.md", "NOTICE.md", "INSTALL.txt", "docs/USER_GUIDE.md", "SHA256SUMS.txt"):
                self.assertIn(name, archive.namelist())
        for line in (dest / "SHA256SUMS.txt").read_text(encoding="utf-8").splitlines():
            digest, name = line.split("  ")
            self.assertEqual(digest, builder.sha256((dest / name).read_bytes()))

    def test_build_refuses_unsynchronized_versions(self):
        (self.root / "package.json").write_text('{"version":"9.9.9"}', encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "versions differ"):
            builder.build(self.root)
        self.assertFalse((self.root / "dist").exists())


if __name__ == "__main__":
    unittest.main()
