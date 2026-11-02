# iPhone Shortcuts for Jarvis

All of these use Apple's free **Shortcuts** app. Replace `jv_…` with a **device token** from Jarvis → Settings → Personal → Device tokens. Use one token for your iPhone with the **health** and **workouts** permissions, and a separate one if you forward messages.

## 1. "Jarvis": talk to Jarvis (Siri and the Action Button)

1. Shortcuts → **+** → **Add Action** → search **Claude** → **Ask Claude** (or **Open App → Claude**). Name it **Jarvis**.
2. Say **"Hey Siri, Jarvis"**, or map it to the Action Button: Settings → Action Button → Shortcut → Jarvis.
3. Once Claude opens, tap the **voice** button. There isn't a Shortcuts action that starts voice mode directly yet.

## 2. "Jarvis Health Sync": MyFitnessPal and weight → Jarvis (daily, automatic)

MyFitnessPal has no public API, but it writes to **Apple Health**, and so do your scales and Apple Watch (steps, active energy). This shortcut reads today's totals from Health and sends them to Jarvis.

**First, in MyFitnessPal:** Settings → Sharing & Privacy → Apple Health → allow it to **write** Dietary Energy, Protein, Carbohydrates, Total Fat and Weight. Also check the Health app → Browse → Nutrition shows MyFitnessPal data.

**Create the automation:**

1. Shortcuts → **Automation** → **+** → **Time of Day** → **23:30**, Daily → **Run Immediately** → **New Blank Automation**.
2. For each nutrient below, add these three actions:
   1. **Find Health Samples**: Type is *Dietary Energy*; Start Date *is today*.
   2. **Calculate Statistics**: *Sum* of Health Samples.
   3. **Set Variable**: `Calories`.

   Repeat for *Protein* → `Protein`, *Carbohydrates* → `Carbs`, and *Total Fat* → `Fat`.
3. Add **Find Health Samples**: Type *Weight*, Start Date *is in the last 1 days*, Sort by *Start Date*, Order *Latest First*, Limit *1*. Then **Convert Measurement** → *kilograms*, then **Set Variable** `Weight`. If you don't weigh in every day, this sends nothing on those days, which is fine.
4. Optionally, do the same with *Steps* (Sum → `Steps`) and *Active Energy* (Sum → `Active`).
5. Add **Format Date**: *Current Date*, Custom format `yyyy-MM-dd` → `Today`.
6. Add **Get Contents of URL**:
   - URL: `https://jarvis-qevero.netlify.app/api/ingest/health`
   - Method: **POST**
   - Headers: `Authorization` = `Bearer jv_…`
   - Request Body: **JSON**, with these keys (all Text):
     - `day` = `Today`
     - `calories` = `Calories`
     - `protein` = `Protein`
     - `carbs` = `Carbs`
     - `fat` = `Fat`
     - `weight` = `Weight`
     - `steps` = `Steps`
     - `active_energy` = `Active`
7. Save, then tap the automation and choose **Run** to test. Jarvis → **Health** should show today.

**Tips:**
- Values with units ("2,104 kcal", "82.4 kg", "176 lb") are fine; Jarvis cleans them up. Missing values are ignored and never overwrite earlier ones.
- To capture food you log late, duplicate the automation for **07:00** with Start Date *is yesterday*, and use a `Yesterday` date via **Adjust Date** → subtract 1 day.

## 3. Hevy (lifts, sets, PRs)

- **With Hevy Pro:** Hevy → Settings → **Developer** → copy the API key, then Jarvis → Settings → Personal → Hevy → **Connect**. Workouts sync every 6 hours, or ask Jarvis to "refresh Hevy".
- **Without Pro:** turn on Hevy → Settings → Apple Health so workouts reach Health. Then optionally add a **workouts** section to the health shortcut (Find Health Samples: *Workouts*, today → POST `title`, `started_at`, `duration_min`, `active_kcal` to `/api/ingest/workouts`). You'll get session counts and duration, but not sets or weights.

## 4. "Jarvis Dashboard"

Open Jarvis in Safari → Share → **Add to Home Screen**. Notifications (morning briefing, deadlines) need the Home Screen app: open it, then Settings → Enable notifications.
