ZENDUONE — OPERATIONS COMMAND CENTER
MyGeotab Add-In v1.0.0
support@zenduit.com

------------------------------------------------------------
WHAT'S IN THE PACKAGE
------------------------------------------------------------
configuration.json   Add-In manifest (references files by name)
main.html            The whole dashboard — markup, styles, and API logic,
                     fully self-contained with no CDN dependencies
icon.svg             Menu icon (single filled path so MyGeotab recolours it)
README.txt           This file

------------------------------------------------------------
INSTALL
------------------------------------------------------------
1. In MyGeotab, go to Administration > System > System Settings > Add-Ins.
2. Turn on "Allow unsigned Add-Ins".
3. Click New Add-In, open the Configuration tab, and paste the contents
   of configuration.json.
4. Switch to the Files tab and upload main.html and icon.svg.
5. Save, then reload MyGeotab. The dashboard appears under
   Activity > Operations Command Center.

To move the menu item, change "path" in configuration.json:
   "ActivityLink/"           Activity menu (default)
   "EngineMaintenanceLink/"  Engine & Maintenance menu
   ""                        top level of the main navigation

------------------------------------------------------------
PREVIEW WITHOUT MYGEOTAB
------------------------------------------------------------
Open main.html in a browser. It detects that the Geotab API is absent,
loads sample data, and shows a "Preview mode" banner so the layout can be
reviewed and demoed before install.

------------------------------------------------------------
CONTROLS
------------------------------------------------------------
Group         Full hierarchy. Selecting a parent includes every asset in
              its children, all the way down.
Sites by      "Sub-groups of selection" rolls assets up to the direct
              children of the selected group. "Asset's own group" reports
              each asset under the most specific group it belongs to —
              use this when sites sit several levels deep.
Offline after An asset counts as offline once it has gone this long without
              sending data. Drives the KPI strip, the site table, and the
              offline list at the same time.
Units         Odometer in kilometres or miles.
Refresh       Re-pulls everything from MyGeotab.

Both tabs and every export respect the current filters.

------------------------------------------------------------
WHERE THE NUMBERS COME FROM
------------------------------------------------------------
Total assets      Device records active as of now, filtered to the group
Active today      Last reported timestamp is after local midnight
Devices reporting Last reported inside the offline threshold
Active fleet      Devices reporting / total assets
Active faults     FaultData over the last 30 days, kept only where
                  faultState = Active and the fault is not dismissed
Odometer          StatusData, DiagnosticOdometerAdjustmentId (metres)
Engine hours      StatusData, DiagnosticEngineHoursAdjustmentId (seconds)
Last driver       DeviceStatusInfo.driver

The account running the Add-In needs view access to Devices, Device Status,
Status Data, Fault Data, and Groups. If a call is rejected, an amber banner
names the problem instead of the page failing silently.

------------------------------------------------------------
CAMERA HEALTH AND DRIVER SCORECARD — NOT WIRED YET
------------------------------------------------------------
Camera counts, offline cameras, cameras not recording, and the driver
scorecard are deliberately left empty; those feeds come from outside
MyGeotab. Each one has a stub near the top of the <script> block in
main.html:

  CameraSource.isConfigured()      return true once the feed is live
  CameraSource.getCounts()         { total, offline, notRecording }
  CameraSource.getOfflineCameras() [{ name, asset, site, lastSeen, status }]
  CameraSource.getNotRecording()   [{ name, asset, site, channel, lastClip, reason }]

  ScorecardSource.isConfigured()
  ScorecardSource.getDriverScores() [{ driver, site, score, harshEvents,
                                       distanceKm, trend }]

Return arrays in those shapes and the KPI tiles and tables fill in. Until
then each panel carries a "Source pending" tag so nobody reads a blank
table as a zero.

------------------------------------------------------------
EXPORTS
------------------------------------------------------------
Site performance, offline assets, asset meters, and all active fault codes
each export to CSV (UTF-8 with BOM, opens straight into Excel). Exports
always match what is on screen, including the group filter and unit choice.

------------------------------------------------------------
TUNING
------------------------------------------------------------
The CFG object at the top of the <script> block holds the fault lookback
window (30 days), result limits, and the two diagnostic IDs. Change them
there if a database needs a wider window or different meter diagnostics.
