# Demo Face Seeding

Use this folder to populate the system from the selected VGGFace2 people already prepared for this project.

The seeder generates real InsightFace embeddings from the selected registration images. It does not create fake/random face vectors.

## Expected Folder Layout

Put the selected VGGFace2 identity folders directly inside `backend/demo_seed/faces`:

```text
backend/demo_seed/faces/
  Aarav_Sharma/
    forward.jpg
    left.jpg
    right.jpg
    manifest.json                  # optional, ignored by the seeder
    remaining/
      Aarav_Sharma_0004_01.jpg
      Aarav_Sharma_0005_01.jpg
```

The seeder uses only these top-level selected registration images for each person:

- `forward.jpg`
- `left.jpg`
- `right.jpg`

It ignores `remaining/`. Use those remaining images later for manual check-in upload tests, not for initial registration.

## Run

From the project root:

```bash
cd backend
source venv/bin/activate
python demo_seed/seed_from_faces.py
```

By default, the script:

- Reads selected VGGFace2 people from `backend/demo_seed/faces`.
- Backs up `backend/db/patients.json`.
- Backs up `backend/db/checkin_attempts.json`.
- Removes previous records created by this demo seed script before adding the new seed records.
- Adds demo patients using the folder names as patient names.
- Registers `forward.jpg`, `left.jpg`, and `right.jpg` as that patient's face samples.
- Generates dashboard-friendly check-in attempt logs.
- Keeps any real/non-demo patients and attempts.

During check-in, those three registered samples are expanded into seven comparison vectors at runtime: the three originals, three pair averages, and one all-angle average.

## Useful Options

Preview folder detection without writing files:

```bash
python demo_seed/seed_from_faces.py --dry-run
```

Seed patients but skip fake check-in attempt logs:

```bash
python demo_seed/seed_from_faces.py --skip-attempts
```

Replace all patient and attempt data with only the demo seed data:

```bash
python demo_seed/seed_from_faces.py --clear-all
```

`--reset-all` is also supported as an alias for this.

Clear only previous seed records without adding new seed data:

```bash
python demo_seed/seed_from_faces.py --clear-seeded-only
```

Clear all patient and check-in attempt data without adding new seed data:

```bash
python demo_seed/seed_from_faces.py --clear-all-only
```

Use a different selected-face folder:

```bash
python demo_seed/seed_from_faces.py --faces-dir /path/to/selected_faces
```

## Notes

- Only use face photos you are allowed to use.
- If an image contains multiple faces, the script uses the largest detected face.
- A person is seeded only when all three selected registration images produce usable embeddings.
- If any selected image fails, that person is skipped so seeded patients never have fewer than three face scans.
- The actual check-in flow should be tested with webcam captures and uploaded images from `remaining/` after seeding.
- The JSON database files are local-only and ignored by git.
