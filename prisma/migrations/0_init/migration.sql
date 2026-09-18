-- CreateTable
CREATE TABLE "athlete_profile" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "age" INTEGER,
    "sex" TEXT,
    "heightCm" REAL,
    "weightKg" REAL,
    "goalRace" TEXT,
    "goalRaceDate" DATETIME,
    "fitnessLevel" TEXT,
    "injuryHistory" TEXT,
    "hrZonesJson" TEXT,
    "trainingPacesJson" TEXT,
    "keyLiftLoadsJson" TEXT,
    "plyoTier" INTEGER,
    "plyoTierSource" TEXT,
    "plyoTierConfidence" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "currentPainLevel" TEXT NOT NULL DEFAULT 'none',
    "recoveryContextJson" TEXT
);

-- CreateTable
CREATE TABLE "calibration_state" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "startedOn" DATETIME,
    "windowEnd" DATETIME,
    "recoveryBaselineReady" BOOLEAN NOT NULL DEFAULT false,
    "anchorConfidenceJson" TEXT,
    "graduated" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "field_tests" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "type" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "result" TEXT NOT NULL,
    "derivedEstimate" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "readiness_daily" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" DATETIME NOT NULL,
    "recoveryScore" REAL,
    "hrv" REAL,
    "hrvBaseline" REAL,
    "rhr" REAL,
    "rhrBaseline" REAL,
    "sleepScore" REAL,
    "sleepHours" REAL,
    "bodyBattery" REAL,
    "stress" REAL,
    "trainingReadiness" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "activities" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" DATETIME NOT NULL,
    "type" TEXT NOT NULL,
    "durationMin" REAL,
    "distanceKm" REAL,
    "avgHr" REAL,
    "maxHr" REAL,
    "avgPaceSecPerKm" REAL,
    "splits" TEXT,
    "cadence" REAL,
    "elevationM" REAL,
    "trimp" REAL,
    "decoupling" REAL,
    "garminActivityId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "session" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "blocksJson" TEXT NOT NULL,
    "sourceOfLastEdit" TEXT,
    "plannedDurationMin" REAL,
    "plannedLoad" REAL,
    "actualDurationMin" REAL,
    "srpe" REAL,
    "actualLoad" REAL,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "set_logs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sessionId" INTEGER NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "setNumber" INTEGER NOT NULL,
    "weightKg" REAL,
    "reps" INTEGER,
    "rir" INTEGER,
    "rpe" REAL,
    "notes" TEXT,
    "itemId" TEXT,
    "itemKind" TEXT NOT NULL DEFAULT 'exercise',
    "contacts" INTEGER,
    "holdSec" INTEGER,
    "cleanExecution" BOOLEAN,
    "sorenessNextDay" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "edit_history" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sessionId" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "actor" TEXT NOT NULL,
    "diffJson" TEXT NOT NULL,
    "reason" TEXT,
    "groupId" TEXT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "exercise_library" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "primaryMuscles" TEXT NOT NULL,
    "secondaryMuscles" TEXT NOT NULL,
    "equipment" TEXT NOT NULL,
    "level" TEXT,
    "mechanic" TEXT,
    "force" TEXT,
    "category" TEXT,
    "instructions" TEXT NOT NULL,
    "images" TEXT NOT NULL,
    "muscleText" TEXT,
    "rationale" TEXT,
    "evidence" TEXT,
    "source" TEXT NOT NULL DEFAULT 'free-exercise-db'
);

-- CreateTable
CREATE TABLE "plyo_library" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "intensity" TEXT,
    "contactLoad" TEXT,
    "progressionTier" INTEGER NOT NULL,
    "prerequisites" TEXT,
    "target" TEXT,
    "videoUrl" TEXT,
    "muscleText" TEXT,
    "rationale" TEXT,
    "evidence" TEXT
);

-- CreateTable
CREATE TABLE "prehab_library" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "bodyRegion" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "niggleTags" TEXT NOT NULL,
    "targetTissue" TEXT,
    "videoUrl" TEXT,
    "muscleText" TEXT,
    "rationale" TEXT,
    "evidence" TEXT
);

-- CreateTable
CREATE TABLE "stretch_library" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "target" TEXT,
    "whenToUse" TEXT NOT NULL,
    "durationSec" INTEGER,
    "reps" INTEGER,
    "muscleText" TEXT,
    "rationale" TEXT
);

-- CreateTable
CREATE TABLE "plan" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "goalRace" TEXT,
    "phase" TEXT,
    "weekInBlock" INTEGER,
    "weeklyVolumeTargetKm" REAL,
    "intensityDistributionJson" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "planned_session" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" DATETIME NOT NULL,
    "modality" TEXT NOT NULL,
    "targetSpecJson" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'B',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "preferences" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "rule" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "confidence" REAL NOT NULL DEFAULT 1.0,
    "weight" REAL NOT NULL DEFAULT 1.0,
    "scope" TEXT,
    "subject" TEXT,
    "sourceQuote" TEXT,
    "statedOn" DATETIME,
    "supersededById" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "confirmedAt" DATETIME,
    "lastAppliedOn" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "decision_log" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" DATETIME NOT NULL,
    "recommendedSessionJson" TEXT NOT NULL,
    "rationale" TEXT,
    "readinessAtDecision" TEXT,
    "wasFollowed" BOOLEAN,
    "athleteOverride" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "niggle_log" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" DATETIME NOT NULL,
    "bodyRegion" TEXT NOT NULL,
    "side" TEXT,
    "severity" INTEGER NOT NULL,
    "quality" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "firstReportedOn" DATETIME NOT NULL,
    "resolvedOn" DATETIME,
    "escalatedOn" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "garmin_push_log" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sessionId" INTEGER NOT NULL,
    "date" DATETIME NOT NULL,
    "status" TEXT NOT NULL,
    "garminWorkoutId" TEXT,
    "payloadJson" TEXT,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "personal_records" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "kind" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "value" REAL NOT NULL,
    "unit" TEXT NOT NULL,
    "reps" INTEGER,
    "achievedOn" DATETIME NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'logged',
    "sessionId" INTEGER,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "supersededById" INTEGER,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "clearance_history" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "recordedOn" DATETIME NOT NULL,
    "clearanceJson" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "setBy" TEXT NOT NULL,
    "sourceQuote" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "week_summary" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "weekStart" DATETIME NOT NULL,
    "totalLoad" REAL,
    "runKm" REAL,
    "runMinutes" REAL,
    "strengthSets" INTEGER,
    "plyoContacts" INTEGER,
    "sessionsPlanned" INTEGER,
    "sessionsDone" INTEGER,
    "acwrEnd" REAL,
    "summaryJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "readiness_daily_date_key" ON "readiness_daily"("date");

-- CreateIndex
CREATE UNIQUE INDEX "activities_garminActivityId_key" ON "activities"("garminActivityId");

-- CreateIndex
CREATE INDEX "activities_date_idx" ON "activities"("date");

-- CreateIndex
CREATE UNIQUE INDEX "session_date_key" ON "session"("date");

-- CreateIndex
CREATE INDEX "set_logs_sessionId_idx" ON "set_logs"("sessionId");

-- CreateIndex
CREATE INDEX "set_logs_itemId_idx" ON "set_logs"("itemId");

-- CreateIndex
CREATE INDEX "edit_history_sessionId_idx" ON "edit_history"("sessionId");

-- CreateIndex
CREATE INDEX "edit_history_groupId_idx" ON "edit_history"("groupId");

-- CreateIndex
CREATE INDEX "planned_session_date_idx" ON "planned_session"("date");

-- CreateIndex
CREATE INDEX "preferences_active_scope_idx" ON "preferences"("active", "scope");

-- CreateIndex
CREATE INDEX "decision_log_date_idx" ON "decision_log"("date");

-- CreateIndex
CREATE INDEX "niggle_log_date_idx" ON "niggle_log"("date");

-- CreateIndex
CREATE INDEX "niggle_log_bodyRegion_status_idx" ON "niggle_log"("bodyRegion", "status");

-- CreateIndex
CREATE INDEX "garmin_push_log_sessionId_idx" ON "garmin_push_log"("sessionId");

-- CreateIndex
CREATE INDEX "personal_records_kind_subjectId_achievedOn_idx" ON "personal_records"("kind", "subjectId", "achievedOn");

-- CreateIndex
CREATE INDEX "clearance_history_recordedOn_idx" ON "clearance_history"("recordedOn");

-- CreateIndex
CREATE UNIQUE INDEX "week_summary_weekStart_key" ON "week_summary"("weekStart");
