# Permission explanation strings

These strings appear in the OS permission dialogs and in the app's
pre-permission primer sheet (SH-07). They are already configured in
`app.json` for camera and location. This document collects all of them
for store review and translation.

---

## Camera

**OS dialog (app.json, already set):**

> BSAH uses the camera to read a cadet's passport QR code, record a short
> silent session clip, and take care-proof photos. Nothing is recorded until
> you press the button.

**In-app primer (PermissionPrimerSheet):**

> **Why BSAH needs the camera**
>
> The camera is used for three things:
> 1. **Scan a cadet's passport QR code** to check them in to a session.
> 2. **Record a short, silent video clip** of the session (only if the
>    parent has given consent).
> 3. **Take a care-proof photo** to show that morning or evening care was
>    completed.
>
> The camera is never used in the background. No audio is recorded.
> You choose when to press the shutter.

**If denied / blocked:**

> Camera access was denied. To scan passports, record session clips, or take
> care-proof photos, please enable camera access in your device settings.

---

## Location (when in use)

**OS dialog (app.json, already set):**

> BSAH checks your location only when you punch in or send care proof, so
> the hub can see the work was done at the yard.

**In-app primer (PermissionPrimerSheet):**

> **Why BSAH needs your location**
>
> When you punch in for a shift or submit a care-proof photo, BSAH records
> your approximate location so the hub can confirm the work happened at
> the yard.
>
> Location is checked **only when you press the button** — never in the
> background. BSAH does not track where you go.

**If denied / blocked:**

> Location access was denied. To punch in or submit care proof, please
> enable location access (While Using the App) in your device settings.

---

## Microphone

**Not requested.** The app is configured with `microphonePermission: false`
and `recordAudioAndroid: false`. No microphone permission string is needed.

If a future version adds audio, the following string is prepared:

> BSAH would use the microphone only to record audio during a session clip.
> No audio is recorded without your explicit action.

---

## Notifications (future — not yet implemented)

Prepared for when push notifications are added:

> BSAH sends notifications when your child's session is published, when a
> consent review is needed, or when a care task is due. You can turn
> notifications off at any time in Settings.

---

## Photo Library (not requested)

BSAH does not access the photo library. All photos and videos are captured
directly through the camera and uploaded without saving to the device gallery.
