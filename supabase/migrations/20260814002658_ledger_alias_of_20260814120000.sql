/*
  # Ledger alias: version 20260814002658 (comment-only; contains NO executable SQL)

  STATUS: LOCAL PROPOSAL (Step 4B preparation, unapproved for any hosted record). Not part of the sealed 28-file executor package.

  ## Why this file exists
  The Development migration ledger records the migration whose repository file is version 20260814120000 under a DIFFERENT
  version, 20260814002658, because the original site builder (Bolt) applied it through the Supabase connector, which stamps its own
  timestamp and writes no file. The ledger therefore holds a version that has no file in this directory, and the standard Supabase CLI
  and GitHub integration refuse to continue ("Remote migration versions not found in local migrations directory").
  This file supplies the missing local file for that one version so that the versions match. It exists ONLY to reconcile historical
  version naming.

  ## What it does
  Nothing. It contains no table, trigger, function, policy, grant or data statement. Applying it runs no SQL. The schema change it stands
  for is made by the migration with version 20260814120000, which is NOT modified and NOT duplicated here.

  ## Treatment on existing databases
  - Development: the ledger already has a row for this version, so this file is already "recorded"; nothing is written for it.
    The migration with version 20260814120000 has no Development row and is recorded WITHOUT executing it (a history-only row), because
    its effects already exist under this alias version.
  - Production: the ledger has no row for this version. Production records the migration with version 20260814120000 as pending
    for real (it has never been applied there). This file is a harmless no-op there; it is recorded or applied in Production's own
    reconciliation, before the file reaches the main branch, and never by the Development procedure.

  ## Version
  20260814002658 is unique in this directory and sorts before 20260814120000. It is older than the existing ledger heads, so on a
  database whose ledger lacks it, the standard tooling treats it as pending until it is recorded.
*/
