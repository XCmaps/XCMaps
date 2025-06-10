import { keycloak } from './keycloak-auth.js'; // Import keycloak

const InfoControl = L.Control.extend({
    onAdd: function(map) {
        // --- Create the button on the map ---
        var container = L.DomUtil.create('div', 'info-control leaflet-bar leaflet-control');
        var link = L.DomUtil.create('a', 'leaflet-control-button', container);
        link.href = '#';
        var img = L.DomUtil.create('img', 'info-control-icon', link);
        img.src = 'assets/images/info.png';
        img.alt = 'Information';
        img.style.width = '24px'; img.style.height = '24px'; img.style.padding = '4px';

        L.DomEvent.disableClickPropagation(container);

        // --- Modal/Popup state variables ---
        let modalOverlay = null;
        let modalContent = null;
        let contentAreaDiv = null;
        let headerDiv = null;
        let footerDiv = null;
        let breadcrumbDiv = null;
        let feedbackDropzone = null;
        let currentFeedbackForm = null;
        let isModalStructureBuilt = false;

        // --- Content Definitions ---
        const popupSections = {
            // Home section removed - will be generated dynamically in updateView
            privacy: `
                <h3>XCMaps Privacy Policy</h3>
                <p>At XCMaps (referred to as "we", "us" or "our" in this policy), we understand the importance of protecting your personal data. This privacy policy explains how we collect, use, share and store information when you access our website at XCMaps.com, which is operated by us, and any other services provided by flyXC (collectively referred to as the "Services").</p>
                <p>You acknowledge that this Privacy Policy is part of our Site Terms of Use, and by accessing or using our site, you agree to be bound by all of its terms and conditions. If you do not agree to these terms, please do not access or use this site.</p>
                <p>We reserve the right to change this Privacy Policy at any time. Such changes, modifications, additions or deletions shall be effective immediately upon notice thereof, which may be given by means including, but not limited to issuing an email to the email address listed by registered users and posting the revised Policy on this page. You acknowledge and agree that it is your responsibility to maintain a valid email address as a registered user, review this site and this Policy periodically and to be aware of any modifications. Your continued use of the site after such modifications will constitute your: (a) acknowledgment of the modified Policy; and (b) agreement to abide and be bound by the modified Policy.</p>
                <h4>1. Information We Collect</h4>
                <p>We collect two types of information: Personal Data and Non-Personal Data.</p>
                <p><strong>A) Personal Data:</strong> This includes data that can be used to directly or indirectly identify you, such as your name, location, email address, and other similar information. You are not required to provide the personal data that we have requested, but if you choose not to do so, in many cases we will not be able to provide you with our products or services, and/or respond to any queries or requests you may have.</p>
                <p><strong>B) Non-Personal Data:</strong> This includes information that cannot identify a specific individual, such as browser types, operating systems, and the pages viewed while navigating through the Services. We collect this data using cookies and other similar technologies.</p>
                <h4>2. How We Collect Information</h4>
                <p>We may obtain Personal Data from you when you:</p>
                <ul><li>Register on our website or application;</li><li>Submit an inquiry through the Services;</li><li>Communicate with us via email, phone, or other means</li></ul>
                <p>We do not collect any Personally Identifiable Information about you unless you voluntarily provide it to us. You provide certain Personally Identifiable Information to us when you register your account.</p>
                <p>We collect your registered tracker positions continuously and use that to display your position on the map for up to 48 hours. By signing up for XCMaps and registering your tracker devices, you acknowledge and agree that your tracker devices location will be displayed and viewable via our services.</p>
                <p>For safety purpose, we keep an archive of the last 30 days for the live tracks. The archive is not publicly accessible.</p>
                <p>We reserve the right to use any track uploaded on our services. i.e. to derive heat maps of thermal locations.</p>
                <h4>3. How We Use Information</h4>
                <p>We use your information to:</p>
                <ul><li>Provide and improve our products and services;</li><li>Respond to requests, inquiries, and comments;</li><li>Analyze usage trends and preferences;</li><li>Comply with legal obligations;</li><li>Enforce our terms of service;</li><li>Protect the rights, property, or safety of XCMaps, our users, or others.</li></ul>
                <h4>4. How We Share Information</h4>
                <p>We may share your information:</p>
                <ul><li>With third parties who provide services on our behalf;</li><li>In response to legal process;</li><li>To investigate suspected fraud or potential threats to the security of our Services;</li><li>In connection with an acquisition, merger, or sale of assets;</li><li>When we have your explicit consent.</li></ul>
                <h4>5. How We Store Information</h4>
                <p>We store your information on secure servers that are protected by appropriate physical, technical, and organizational measures designed to prevent unauthorized access, loss, misuse, disclosure, alteration, and destruction. However, no electronic transmission or storage of data is completely secure, so we cannot guarantee the absolute security of this information.</p>
                <h4>6. Your Rights</h4>
                <p>You have certain rights regarding your Personal Data, subject to local law. These include the right to request access, correction, erasure, restriction, portability, and objection to processing of your Personal Data. You can exercise these rights by contacting us using the details provided in this policy.</p>
                <h4>7. Children's Privacy</h4>
                <p>Our Services are not directed at children under 16 years old. If you learn that a child has provided us with their information without consent, please contact us immediately so we can take appropriate action.</p>
                <h4>8. Changes to This Policy</h4>
                <p>We may update our privacy policy from time to time. When we make significant changes, we will notify you by posting a notice on our website or through other communication channels. We encourage you to review this page periodically for the latest information on our privacy practices.</p>
                <h4>9. Contact Information</h4>
                <p>If you have any questions about this Privacy Policy, please contact us at: info@XCMaps.com</p>
            `,
            terms: `
                <h3>XCMaps Terms and Conditions</h3>
                <p>This website, XCMaps.com (the "Website"), provides various data sources for para- and hang-gliders, providing valuable insights for the community.</p>
                <p>By using the Website, you agree to these terms and conditions (the "Terms") and acknowledge that they constitute a legally binding contract between you and XCMaps. If you do not agree to these Terms, please do not use the Website. We reserve the right to modify or update these Terms at any time without prior notice. Your continued use of the Website after any changes indicates your acceptance of the new terms and conditions. Therefore, we recommend that you review these Terms regularly for any changes.</p>

                <h4>1. Purpose of the Website</h4>
                <p>The purpose of the Website is to enhance safety and education in free flight sports such as paragliding and hang gliding. The Website provides users with access to various features, including:</p>
                <ul>
                  <li><strong>Weather Stations:</strong> Wind, Gusts, Direction, Temp and Camera if available</li>
                  <li><strong>Rain Viewer:</strong> Radar and Satellite incl. forecast</li>
                  <li><strong>Thermals:</strong> kk7 thermal map</li>
                  <li><strong>Spots:</strong> Para- and Hangliding take-off and Landing Zones (© <a href="https://paraglidingspots.com" target="_blank">paraglidingspots.com</a>)</li>
                  <li><strong>Airspaces:</strong> Xcontest Airspaces & Activations, filter for today and the next 6 days</li>
                  <li><strong>Obstacles:</strong> OSM based obstacles from Xcontest</li>
                </ul>

                <h4>2. Data Collection and Use</h4>
                <p>XCMaps does not collect data from its users.</p>
                <p>XCMaps does not sell, rent, or otherwise share your personal information with any third parties, except as required by law or as necessary to protect the rights, property, or safety of XCMaps, its employees, users, or others. XCMaps may also disclose your data if it is involved in a merger, acquisition, or sale of all or part of its assets.</p>

                <h4>3. Ownership and Intellectual Property Rights</h4>
                <p>The Website, including but not limited to its design, layout, content, graphics, images, audio, video, and code, is owned by XCMaps and protected by copyright laws and international intellectual property rights. You may not reproduce, modify, distribute, sell, or otherwise use any part of the Website without the prior written consent of XCMaps.</p>

                <h4>4. Disclaimer of Warranties and Liability</h4>
                <p>The Website is provided "as is" and "as available". XCMaps disclaims all warranties, express or implied, including but not limited to warranties of merchantability, fitness for a particular purpose, title, non-infringement, and security. XCMaps does not guarantee that the Website will be error-free, uninterrupted, or accessible at all times. XCMaps is not responsible for any losses, damages, or expenses arising from your use of the Website, including but not limited to direct, indirect, special, incidental, consequential, or punitive damages. XCMaps also disclaims any liability for any actions taken by you or others based on the information provided by the Website, which may be inaccurate, incomplete, or outdated.</p>

                <h4>5. Indemnification</h4>
                <p>You agree to indemnify and hold harmless XCMaps, its officers, directors, employees, agents, licensors, and suppliers from any claims, actions, demands, liabilities, costs, damages, and expenses (including reasonable attorneys' fees) arising from your use of the Website or your violation of these Terms.</p>

                <h4>6. Applicable Law and Dispute Resolution</h4>
                <p>These Terms shall be governed by and construed in accordance with the laws of France, without giving effect to any principles of conflicts of law. Any disputes arising out of or in connection with these Terms or your use of the Website shall be subject to the exclusive jurisdiction of the courts of England and Wales.</p>

                <h4>7. Entire Agreement</h4>
                <p>These Terms constitute the entire agreement between you and XCMaps regarding your use of the Website and supersede any prior agreements, understandings, or representations, whether written or oral. If any provision of these Terms is found to be unenforceable or invalid, that provision shall be limited or eliminated to the minimum extent necessary so that these Terms shall otherwise remain in full force and effect and enforceable.</p>
                <p>By using the Website, you acknowledge that you have read, understood, and agreed to these Terms. If you do not agree to these Terms, please do not use the Website.</p>
            `,
            changelog: `
                <h3>Change Log</h3>
                <p><strong>2025-JUN-06 version 1.2.1</strong></p>
                <ul>
                <li>XCTrack web widget: get GPS directly from XCTRack for faster processing</li>
                <li>Rain Viewer: is now paused by default for better in-flight experience (layer is still updated every 10 minutes)</li>
                <li>Rain Viewer: show timecontrol badge above leaflet-contributions</li>
                <li>XCMaps User: added a login badge on click of the user control to avoid redirects to the login page when clicking the user control by mistake. </li>
                <li>Spots: added DHV icon for all spots in the DHV database; details will follow</li>
                </ul>
                <p><strong>2025-MAY-29 version 1.2.0</strong></p>
                <ul>
                <li>#52 XCTrack Web Page Widget Support: Custom Map Overlays Using URL Parameters.</br>
                 - Please read the description in the Info popup.</li>
                <li>#49 Airspaces popup: full-screen on mobile devices for better usability </li>
                <li>#53 Airspaces popup: airspaces are sorted by lower floor level</li>
                <li>#55 LIVE! Viewer: First-Packet Validator </br>
                  - Drop first packet of devices sending erroneous packets when they are switched on. </li>
                </ul>
                <p><strong>2025-MAY-22 version 1.1.1</strong></p>
                <ul>
                <li>#44 Remove obviously wrong points in live viewer</br>
                 - (track-filter module to filter wrong packets)</li>
                <li>#45 Show ground speed in the live viewer popup </li>
                <li>#48 Second click on a marker also closes popup, track and chart </br>
                  - (previously it worked only on click of popup) </li>
                </ul>
                <p><strong>2025-MAY-16 version 1.1.0</strong></p>
                <p><strong>new feature: LIVE! OGN & XContest/XCTrack Viewer</strong></p>
                <ul>
                <li>marker icons for flying (PG), flying (HG), helicopter, resting, hiking, driving</li>
                <li>marker colors based on vertical speed </li>
                <li>on-click: </br>
                  - popup with pilot name (or device ID), last update, altitude, AGL, vertical speed </br>
                  - flight tracks in different colors </br>
                  - chart with elevation line and ground level (for one active marker) </li>
                <li>LIVE! control: activate/deactivate LIVE! Viewer, resting, hiking or driving pilots </li>
                <li>XCMaps users: edit your XCMaps pilot name using your device IDs</li>
                <li>XCMaps users: connect your XContest account to be visible on the XCMaps map</li>
                </ul>
                <p><strong>2025-MAY-06 version 1.0.4</strong></p>
                <ul>
                <li>JawgMaps provides their vector map tiles service to XCMaps for free as a sponsor.</br>
                    New default terrain layer is now again Terrain - JawgMaps. </li>
                <li>Rain Viewer: fixed a refresh is
                sue in control-timecontrol.</li>
                <li>Weather Stations: reduced the size of the arrow markers by 15%.</li>
                </ul>
                <p><strong>2025-APR-21 version 1.0.3</strong></p>
                <ul>
                  <li>replaced the default basemap terrain laver from Jawg.io as we were running out of credits in the free tier. </br>
                      New default terrain layer is now the free Esri_WorldTopoMap. </li>
                <li>removed Trigger NOTAMs from default Xcontest airspace layer. </li>
                <li>added a new layer for Trigger NOTAMs </li>
                <p>Trigger NOTAMs are airspaces of airspace Class "(R)" </br> 
                   where airspace description contains: </br>
                   "E) TRIGGER NOTAM" </br> and contains "AIP AMDT" or "AIP SUP" or "AIC"</p>
                </ul>
                <p><strong>2025-APR-18 version 1.0.2</strong></p>
                <ul>
                  <li>fix airspace deduplication logic to skip airspaces with same name but different geometry</li>
                </ul>
                <p><strong>2025-APR-15 version 1.0.1</strong></p>
                <ul>
                  <li>added kk7 skyways layers</li>
                  <li>windstation arrows: show in grey if no update was received within the last 1:01 hours</li>
                  <li>windstation arrows: text shows below arrows to avoid overlapping</li>
                  <li>windstation popup: fixed display of wrong measuring unit in the table for wind and gusts (replaced m/s bei km/H)</li>
                  <li>windstation popup: added the source next to the station name</li>
                  <li>windstation popup: Last Update shows now "X day(s) ago" if no update was received at the current day</li>
                  <li>Airspaces: implemented a deduplication logic to avoid possible showing of dublicate airspaces</li>
                  <li>User Account / improved Save Settings UX: instead of saving the settings on logout, you get now a green "Save Setting" button in the profile-badge if the configuration was changed. Grey button if the configuartion is the same as the stored one.</li>
                  <li>added a change log in Info > Features list</li>
                </ul>
                <p><strong>2025-APR-11 version 1.0.0 "Déco"</strong></p>
                <ul>
                  <li>Weather Stations: Wind, Gusts, Direction, Temp and Camera if available. Marker refresh every 1 minute.</li>
                  <li>Rain Viewer: Radar and Satellite, past 60 min + 20 min forecast</li>
                  <li>Thermals: kk7 thermal map</li>
                  <li>Spots: Para- and Hangliding take-off and Landing Zones (© paraglidingspots.com)</li>
                  <li>Airspaces: Xcontest Airspaces & Activations in local time zone, filter for today and the next 6 days and lowest floor level</li>
                  <li>Obstacles: OSM based obstacles from Xcontest</li>
                  <li>Locate and Track: Locate and Track your position using the Locate Control</li>
                  <li>XCmaps User Account: By using your account, your preferred map layers will be saved when you log out—so every time you log in, you'll return to your personalized view.</li>
                </ul>
            `,
            live: `
                <h3>LIVE! - Real-Time Flight Viewer</h3>
                <p>The LIVE! feature provides real-time viewing of free gliders, integrating data from OGN and XContest to display pilots on the map. This allows users to see live flight activities, enhancing situational awareness and community engagement.</p>

                <h4>Pilot Name Display & Configuration</h4>
                <p>The pilot name displayed on the map can be configured in the profile badge. This name is primarily sourced from several databases and tracking systems. If you have a registered device with any of these services, your chosen identifier or callsign will typically be used. To customize or ensure your preferred name is displayed, check your registration details with the respective service (e.g., your OGN registration, FlarmNet profile, or XContest account settings).</p>
                <p>If your device doesn't have a name or you'd like to use a different one for XCMaps, you can set it in the profile badge. Simply enter your device ID and the name you'd like to display on the map. If we've already received a pilot name from one of the sources below, it will appear automatically after you enter the device ID and click the name field.</p>

                <h4>Sources for Pilot Names and Tracking Data</h4>
                <p>We aggregate pilot information and tracking data from the following sources:</p>
                <ul>
                    <li><strong>OGN Database:</strong> Pilot names are often based on device registration details within the <a href="http://wiki.glidernet.org/ddb" target="_blank">OGN Devices DataBase</a>.</li>
                    <li><strong>Flarmnet Database:</strong> If a pilot is registered on <a href="https://www.flarmnet.org/accounts/login/" target="_blank">Flarmnet</a>, their aircraft details and callsign can be displayed.</li>
                    <li><strong>OGN Status Packages:</strong> Some OGN devices transmit status packages which can include pilot or aircraft identifiers.</li>
                    <li><strong>Puretrack:</strong> Puretrack provides tracking solutions, and data from devices using this service are integrated.</li>
                </ul>

                <h4>XContest & XCTrack Integration</h4>
                <p>XCMaps integrates with XContest, a popular platform for flight logging and contests. If you are using XCTrack (the live tracking application for XContest) and have live tracking enabled, your flights can be visible on XCMaps. This integration allows for a broader view of ongoing flights, including those participating in XContest events or simply using XCTrack for personal live tracking.</p>
                <p>If you want to show your XCTrack flights in XCMaps, please enter your UUID in the profile badge. A link to receive your UUID is included in the profile badge as well.</p>

                <h4>Glider Color Coding (Vertical Speed & Status)</h4>
                <p>Glider icons are color-coded to provide a quick visual indication of their current vertical speed (climb/sink rate) and status. This helps in assessing flight conditions at a glance.</p>
                <table class="table table-sm table-striped table-bordered">
                  <thead class="thead-light">
                    <tr>
                      <th style="width: 60px; text-align: center;">Color</th>
                      <th style="text-align: center;">Vertical Speed (m/s)</th>
                      <th>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style="background-color: #0D400D; border: 1px solid #0D400D;"></td>
                      <td style="text-align: center;">≥ +5.0</td>
                      <td>Strong climb</td>
                    </tr>
                    <tr>
                      <td style="background-color: #289628; border: 1px solid #289628;"></td>
                      <td style="text-align: center;">+3.5 to +4.9</td>
                      <td>Good climb</td>
                    </tr>
                    <tr>
                      <td style="background-color: #5CCD5C; border: 1px solid #5CCD5C;"></td>
                      <td style="text-align: center;">+2.5 to +3.4</td>
                      <td>Moderate climb</td>
                    </tr>
                    <tr>
                      <td style="background-color: #99E699; border: 1px solid #99E699;"></td>
                      <td style="text-align: center;">+1.5 to +2.4</td>
                      <td>Light climb</td>
                    </tr>
                    <tr>
                      <td style="background-color: #CFF2CF; border: 1px solid #CFF2CF;"></td>
                      <td style="text-align: center;">+0.5 to +1.4</td>
                      <td>Weak climb</td>
                    </tr>
                    <tr>
                      <td style="background-color: #FFFFFF; border: 1px solid #CCCCCC;"></td>
                      <td style="text-align: center;">-0.4 to +0.4</td>
                      <td>Neutral (minimal sink/climb)</td>
                    </tr>
                    <tr>
                      <td style="background-color: #FFD700; border: 1px solid #FFD700;"></td>
                      <td style="text-align: center;">-0.5 to -1.4</td>
                      <td>Weak sink</td>
                    </tr>
                    <tr>
                      <td style="background-color: #FFA500; border: 1px solid #FFA500;"></td>
                      <td style="text-align: center;">-1.5 to -2.4</td>
                      <td>Light sink</td>
                    </tr>
                    <tr>
                      <td style="background-color: #FF4500; border: 1px solid #FF4500;"></td>
                      <td style="text-align: center;">-2.5 to -3.4</td>
                      <td>Moderate sink</td>
                    </tr>
                    <tr>
                      <td style="background-color: #FF0000; border: 1px solid #FF0000;"></td>
                      <td style="text-align: center;">-3.5 to -4.9</td>
                      <td>Strong sink</td>
                    </tr>
                    <tr>
                      <td style="background-color: #8B0000; border: 1px solid #8B0000;"></td>
                      <td style="text-align: center;">≤ -5.0</td>
                      <td>Very strong sink</td>
                    </tr>
                    <tr>
                      <td style="background-color: #898989; border: 1px solid #898989;"></td>
                      <td style="text-align: center;">N/A</td>
                      <td>Inactive (no recent position update)</td>
                    </tr>
                  </tbody>
                </table>
                `,
            airspaces: `
                <h3>Airspaces</h3>
                <p>The Airspaces layer displays various types of airspaces relevant to free flight activities. Understanding these airspaces is crucial for safe and legal flying.</p>
                <p>Data is sourced primarily from XContest and OpenAIP, showing current activations based on your local time zone. You can filter the displayed airspaces based on the activation date (today and the next 6 days) and the minimum floor level relevant to your flight altitude.</p>

                <h4>Airspace Types (TYPE=)</h4>
                <p>Each airspace displayed on the map is categorized by a TYPE= code. These codes help free gliders understand the nature and restrictions of each airspace. Below is a breakdown of the permitted values and what they mean:</p>
                <table class="table table-sm table-striped">
                  <thead>
                    <tr>
                      <th>Abbreviation</th>
                      <th>Airspace Type</th>
                      <th>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td>C</td><td>CTA/CTR</td><td>Control Area (CTA) or Control Zone (CTR) — Controlled airspace usually around airports. Permission is required before entry.</td></tr>
                    <tr><td>A</td><td>Airways</td><td>Established routes for commercial and general aviation. Often found at higher altitudes, but may be relevant depending on flight altitude.</td></tr>
                    <tr><td>R</td><td>Restricted</td><td>Flight is restricted in this area. May be temporarily or permanently closed to unauthorized aircraft. Check for NOTAMs.</td></tr>
                    <tr><td>P</td><td>Prohibited</td><td>Absolutely no flying permitted. These areas are closed to all air traffic for safety or security reasons.</td></tr>
                    <tr><td>D</td><td>Danger</td><td>Areas where activities such as military training or weapons testing may pose a danger to aircraft. Entry is not always prohibited but is strongly discouraged without permission.</td></tr>
                    <tr><td>O</td><td>Other</td><td>Used for zones that do not fit into the standard classifications but still represent defined airspaces.</td></tr>
                    <tr><td>Z</td><td>Training Zone</td><td>Areas designated for flight training. High activity from student pilots or military trainees may occur.</td></tr>
                    <tr><td>I</td><td>Traffic Info</td><td>Regions where only traffic information is provided, not air traffic control services. Caution is advised.</td></tr>
                    <tr><td>G</td><td>GSEC (Glider Sector)</td><td>Airspace specifically reserved or suitable for gliding. Typically more favorable and less restricted for paragliders.</td></tr>
                    <tr><td>M</td><td>MATZ (Military Zone)</td><td>Military Air Traffic Zones. Civilian entry might be restricted or require coordination.</td></tr>
                    <tr><td>T</td><td>TMZ (Transponder Mandatory Zone)</td><td>Aircraft entering must be equipped with a Mode S or Mode C transponder. Generally not accessible to paragliders without proper equipment.</td></tr>
                    <tr><td>B</td><td>Boundary</td><td>National or Flight Information Service (FIS) boundaries. Important for understanding jurisdiction changes but usually not restrictive.</td></tr>
                    <tr><td>(Blank) or X</td><td>Unknown/Unset</td><td>No specific type assigned. Airspace may be undefined or data is missing. Treat with caution.</td></tr>
                  </tbody>
                </table>

                <h4>Trigger NOTAM Layer</h4>
                <p>A separate layer is available specifically for "Trigger NOTAMs". These are special types of Restricted (R) airspaces that are activated via NOTAM (Notice to Airmen).</p>
                <p>Trigger NOTAMs are identified based on specific criteria within the airspace description, typically mentioning "TRIGGER NOTAM" along with references like "AIP AMDT", "AIP SUP", or "AIC".</p>
                <p>It is crucial to check current NOTAMs for the activation status of these areas before flying near them, as they often relate to temporary military activities or other hazards.</p>
                <p><strong>Disclaimer:</strong> Airspace data is provided for informational purposes only. Always consult official sources (like the official AIP, NOTAMs) and exercise caution. Flight planning and execution remain the pilot's responsibility.</p>
            `,
           'weather-stations': `
               <h3>Weather Stations</h3>
               <p>The Weather Stations layer displays real-time wind data from various sources, indicated by arrow markers on the map. These markers refresh automatically every minute to provide the latest conditions.</p>
               <p>Each marker visually represents:</p>
               <ul>
                   <li><strong>Wind Direction:</strong> The arrow points in the direction the wind is blowing towards.</li>
                   <li><strong>Average Wind Speed:</strong> Shown numerically inside the arrow (fill color indicates strength).</li>
                   <li><strong>Peak Wind Speed (Gusts):</strong> Also shown numerically inside the arrow (outline color indicates strength).</li>
                   <li><strong>Peak / Valley:</strong> A small triangle (▲/▼) next to the average speed indicates if the weather station is located at a peak (▲) or valley (▼).</li>
               </ul>
               <p>Clicking on a station marker opens a detailed popup. This popup provides:</p>
               <ul>
                   <li>Current wind speed, gusts, direction, and last update time.</li>
                   <li>A table showing historical wind data (average, gusts, direction, temperature) in 10-minute intervals for the past few hours.</li>
                   <li>A chart visualizing the wind speed and gust trends over time.</li>
                   <li>If available, a "Camera" tab displaying the latest image from the station's webcam.</li>

               </ul>

               <h4>Color Coding (km/h)</h4>
               <p>The colors of the arrow and in the popup table provide a quick visual guide to the wind conditions. The fill color represents the average wind speed, and the outline color represents the peak wind speed (gusts).</p>
               <table class="table table-sm table-striped table-bordered">
                 <thead class="thead-light">
                   <tr>
                     <th style="width: 60px; text-align: center;">Color</th>
                     <th style="text-align: center;">Average Wind</th>
                     <th style="text-align: center;">Peak Wind</th>
                     <th>Description</th>
                   </tr>
                 </thead>
                 <tbody>
                   <tr>
                     <td style="background-color: Aquamarine; border: 1px solid Aquamarine;"></td>
                     <td style="text-align: center;">0 - 6</td>
                     <td style="text-align: center;">0 - 14</td>
                     <td>Light wind</td>
                   </tr>
                   <tr>
                     <td style="background-color: LimeGreen; border: 1px solid LimeGreen;"></td>
                     <td style="text-align: center;">7 - 14</td>
                     <td style="text-align: center;">15 - 24</td>
                     <td>Moderate wind</td>
                   </tr>
                   <tr>
                     <td style="background-color: yellow; border: 1px solid yellow;"></td>
                     <td style="text-align: center;">15 - 24</td>
                     <td style="text-align: center;">25 - 32</td>
                     <td>Strong wind</td>
                   </tr>
                   <tr>
                     <td style="background-color: orange; border: 1px solid orange;"></td>
                     <td style="text-align: center;">25 - 30</td>
                     <td style="text-align: center;">33 - 38</td>
                     <td>Very strong wind</td>
                   </tr>
                   <tr>
                     <td style="background-color: red; border: 1px solid red;"></td>
                     <td style="text-align: center;">31 - 36</td>
                     <td style="text-align: center;">39 - 44</td>
                     <td>Gale force wind</td>
                   </tr>
                   <tr>
                     <td style="background-color: black; border: 1px solid black;"></td>
                     <td style="text-align: center;">> 36</td>
                     <td style="text-align: center;">> 44</td>
                     <td>Storm force wind</td>
                   </tr>
                   <tr>
                     <td style="background-color: grey; border: 1px solid grey;"></td>
                     <td colspan="2" style="text-align: center;">Any speed</td>
                     <td>No update for over 1:01 hour</td>
                   </tr>
                 </tbody>
               </table>
               <p><strong>Note:</strong> For readability, the text color for the speed values inside the arrow automatically switches to white when the background color is black.</p>
             `,
              xctrack: `
                  <p>With <strong>XCTrack PRO</strong>, you can integrate <strong>XCMaps</strong> into your XCTrack configuration using the <strong>Web Page Widget</strong> and customize the displayed map using URL parameters.</p>
  
                  <h5>How to Configure the Widget</h5>
                  <p>In the XCTrack widget configuration page activate the following options: </p>
                  <ul>
                      <li>Allow web page to access GPS location</li>
                      <li>Allow web page to access XCTrack data (XCMaps uses the GPS position from XCTrack when available)</li>
                      <li>Allow tapping on the web page when locked </li>
                  </ul>

                  <p>You can configure your desired overlays in one of two ways:</p>
  
                  <h5><strong>1. Log in with Your XCMaps User Account</strong></h5>
                  <p>⚠️ Important Notes:</p>
                  <ul>
                      <li>This method works only with native Android devices running XCTrack and using username/password authentication.</li>
                      <li>Google login will not work because in-app WebViews on Android do not support Google OAuth.</li>
                      <li>AIR³ devices are not compatible with this login method due to redirection issues with the internal XCMaps authentication URL.</li>
                  </ul>
  
                  <h5><strong>2. Use URL Parameters Without a User Account (Recommended)</strong></h5>
                  <ol>
                      <li>Open a browser on your device.</li>
                      <li>Navigate to XCMaps.com.</li>
                      <li>Select your desired base map and overlay layers.</li>
                      <li>Copy the resulting URL from your browser’s address bar (long press for the context menu).</li>
                      <li>Open XCTrack and configure the Web Page Widget.</li>
                      <li>Paste the copied URL into the widget settings (long press to paste).</li>
                  </ol>
  
                  <h5>Available URL Parameters</h5>
                  <p><strong>Base Maps</strong> (Only one base map can be selected at a time.)</p>
                  <ul>
                      <li><code>base=terrain</code> → Terrain – JawgMaps</li>
                      <li><code>base=topo</code> → Topo – Esri</li>
                      <li><code>base=osm</code> → OpenStreetMap</li>
                      <li><code>base=satellite</code> → Satellite imagery</li>
                  </ul>
  
                  <p><strong>Overlay Layers</strong> (Multiple overlays can be included, separated by commas.) <em>Example: <code>overlays=weather_stations,radar</code></em></p>
                  <ul>
                      <li><code>overlays=weather_stations</code> → Weather Stations</li>
                      <li><code>overlays=radar</code> → Rain Viewer – Radar</li>
                      <li><code>overlays=satellite</code> → Rain Viewer – Satellite</li>
                      <li><code>overlays=kk7_thermals</code> → KK7 Thermals</li>
                      <li><code>overlays=kk7_skyways</code> → KK7 Skyways</li>
                      <li><code>overlays=take_off_pg</code> → Paragliding Take-off Points</li>
                      <li><code>overlays=take_off_hg</code> → Hang Gliding Take-off Points</li>
                      <li><code>overlays=landing_zones</code> → Landing Zones</li>
                      <li><code>overlays=airspaces</code> → Airspace (XContest)</li>
                      <li><code>overlays=obstacles</code> → Obstacles</li>
                      <li><code>overlays=live</code> → Live Tracking Layer</li>
                  </ul>
  
                  <h5>Other Parameters</h5>
                  <ul>
                      <li><code>floor_below=<meters></code> → Sets lower airspace limit. Accepted values: 2000, 2500, 3000, 3500, 4000, 4500.
                          Example: <code>floor_below=3000</code></li>
                      <li><code>locate_track=true</code> → Enables the "Locate & Track" control, centering the map on the user’s location.
                          👉 Recommended to include this in widget URLs.</li>
                  </ul>
  
                  <h5><strong>Example URL Combination</strong></h5>
                  <p><code>https://XCMaps.com/?base=terrain&overlays=weather_stations,radar,airspaces&floor_below=2500&locate_track=true</code></p>
                  <p>This URL will:</p>
                  <ul>
                      <li>Use the Terrain base map</li>
                      <li>Show Weather Stations, Radar, and Airspace overlays</li>
                      <li>Set the airspace floor to 2500 meters</li>
                      <li>Center the map on the current user location</li>
                  </ul>
              `
          };

        // --- Function to build the common content structure ---
        function buildContentStructure() {
            const structureContainer = L.DomUtil.create('div', 'info-popup-container');

            headerDiv = L.DomUtil.create('div', 'info-popup-header', structureContainer); // Main header flex container

            // Left side: Logo and Breadcrumbs
            const headerLeft = L.DomUtil.create('div', 'info-popup-header-left', headerDiv);
            const logoImg = L.DomUtil.create('img', 'info-popup-logo', headerLeft);
            logoImg.src = '/assets/images/XCmapsLogo.png';
            logoImg.alt = 'XCMaps Logo';
            breadcrumbDiv = L.DomUtil.create('div', 'info-popup-breadcrumbs', headerLeft);

            // Right side: Social Icons and Close Button
            const headerRight = L.DomUtil.create('div', 'info-popup-header-right', headerDiv);

            // Facebook Icon
            const fbLink = L.DomUtil.create('a', 'social-icon', headerRight);
            fbLink.href = 'https://facebook.com/xcmaps';
            fbLink.target = '_blank'; // Open in new tab
            const fbImg = L.DomUtil.create('img', '', fbLink);
            fbImg.src = 'assets/images/facebook.png';
            fbImg.alt = 'Facebook';

            // GitHub Icon (Assuming no specific link for now)
            const ghLink = L.DomUtil.create('a', 'social-icon', headerRight);
            ghLink.href = 'https://github.com/XCMaps/XCMaps'; 
            ghLink.target = '_blank'; 
            const ghImg = L.DomUtil.create('img', '', ghLink);
            ghImg.src = 'assets/images/github.svg';
            ghImg.alt = 'GitHub';

            // Close Button
            const headerCloseButton = L.DomUtil.create('span', 'info-popup-close', headerRight);
            headerCloseButton.innerHTML = '&times;';
            // Listener added later depending on context
            contentAreaDiv = L.DomUtil.create('div', 'info-popup-content', structureContainer);

            // Footer (Fixed at bottom) - Comments Removed
            footerDiv = L.DomUtil.create('div', 'info-popup-footer d-flex justify-content-between align-items-center', structureContainer);
            footerDiv.innerHTML = `
                <div class="footer-links">
                    <a href="#" data-section="privacy">Privacy Policy</a>
                    <a href="#" data-section="terms">Terms and Conditions</a>
                </div>
                <div class="d-flex align-items-center">
                    <div id="info-feedback-message" class="text-start" style="margin-right: 10px;"></div>
                    <button class="btn btn-primary btn-sm me-2 info-popup-feedback-btn">Feedback</button>
                    <button class="btn btn-dark btn-sm info-popup-footer-close">Close</button>
                </div>
            `;

            updateView('home'); // Set initial content
            L.DomEvent.on(structureContainer, 'click', handleContentClick); // Attach main delegated listener
            return structureContainer;
        }

        // --- Modal Creation and Management ---
        function ensureModalStructureExists() {
            if (isModalStructureBuilt) return;
            modalOverlay = L.DomUtil.create('div', 'info-modal-overlay', document.body);
            modalOverlay.style.display = 'none';
            modalContent = L.DomUtil.create('div', 'info-modal-content', modalOverlay);
            const structure = buildContentStructure();
            modalContent.appendChild(structure);
            const headerCloseButton = modalContent.querySelector('.info-popup-close');
            if (headerCloseButton) L.DomEvent.on(headerCloseButton, 'click', hideModal);
            L.DomEvent.on(modalOverlay, 'click', (ev) => { if (ev.target === modalOverlay) hideModal(); });
            isModalStructureBuilt = true;
        }

        function showModal() {
            ensureModalStructureExists();
            updateView('home');
            if(modalOverlay) modalOverlay.style.display = 'flex';
            if (map) {
                map.dragging.disable(); map.touchZoom.disable(); map.doubleClickZoom.disable();
                map.scrollWheelZoom.disable(); map.boxZoom.disable(); map.keyboard.disable();
                if (map.tap) map.tap.disable();
                L.DomUtil.addClass(map.getContainer(), 'modal-open');
            }
        }

        function hideModal() {
            cancelFeedback(false);
            if (modalOverlay) modalOverlay.style.display = 'none';
            if (map) {
                map.dragging.enable(); map.touchZoom.enable(); map.doubleClickZoom.enable();
                map.scrollWheelZoom.enable(); map.boxZoom.enable(); map.keyboard.enable();
                if (map.tap) map.tap.enable();
                 L.DomUtil.removeClass(map.getContainer(), 'modal-open');
            }
        }

        // --- Fullscreen Trigger ---
        function triggerFullscreen() {
             const contentElement = buildContentStructure();
             const tempPopup = L.popup({ className: 'info-popup', autoPan: false })
             .setLatLng(map.getCenter())
             .setContent(contentElement)
             .openOn(map);
        }

        // --- Shared Update/Feedback/Cancel Logic ---
        function updateView(sectionName) {
            if (!contentAreaDiv || !breadcrumbDiv || !footerDiv) return;
            cancelFeedback(false);
            if (sectionName === 'home') {
                // Generate home content dynamically
              
                contentAreaDiv.innerHTML = `
                    <h3>About XCMaps</h3>
                    <p>XCMaps is a non-commercial, free and open-source project that brings together various data sources for para- and hang-gliders, providing valuable insights for the community.</p>

                    <h3>Contact</h3>
                    <p>You can reach out to us via the Feedback form below or by <a href="mailto:info@XCMaps.com" target="_blank">email</a>.</p>
                    <p>If you’d like to report an issue, such as a bug or a feature request, please visit our <a href="https://github.com/XCMaps/XCMaps" target="_blank">GitHub</a> project page.</p>
                    <p>To stay up-to date on latest updates, please follow us on <a href="https://www.paraglidingforum.com/viewtopic.php?p=687646#687646" target="_blank">Paraglidingforum</a>, <a href="https://facebook.com/xcmaps" target="_blank">Facebook</a> or <a href="https://github.com/XCMaps/XCMaps" target="_blank">GitHub</a>.</p>

                    <p>If you enjoy our content, consider buying us a landing beer! Your support helps keep this service running, as we cover real costs for servers, storage, AI models, and data sources.<br>It’s simple: the more funding we receive, the faster we can roll out new features!</p>
                    <p><a href="https://buymeacoffee.com/XCMaps" target="_blank" class="donation-button"> 🍺 Buy us a Landing Beer</a></p>

                    <h3>Features</h3>
                    <ul>
                      <li><strong><a href="#" data-section="live">LIVE!:</a></strong> OGN & XContest/XCTrack Live Viewer</li>
                      <li><strong><a href="#" data-section="weather-stations">Weather Stations:</a></strong> Wind, Gusts, Direction, Temp and Camera if available. Marker refresh every 1 minute.</li>
                      <li><strong>Rain Viewer:</strong> Radar and Satellite, past 2 hours + 20 min forecast</li>
                      <li><strong>Thermals:</strong> kk7 thermal and skyways map</li>
                      <li><strong>Spots:</strong> Para- and Hangliding take-off and Landing Zones (© <a href="https://paraglidingspots.com" target="_blank">paraglidingspots.com</a>)</li>
                      <li><strong><a href="#" data-section="airspaces">Airspaces:</a></strong> Xcontest Airspaces & Activations in local time zone, filter for today and the next 6 days and lowest floor level. Click the link for details on airspace types.</li>
                      <li><strong>Obstacles:</strong> OSM based obstacles from Xcontest</li>
                      <li><strong>Locate and Track:</strong> Locate and Track your position using the Locate Control</li>
                      <li><strong>XCMaps User Account:</strong> By using your account, your can save your preferred map layers in the profile-badge—so every time you log in, you'll return to your personalized view.</li>
                      <li><strong><a href="#" data-section="xctrack">XCTrack Web Page Widget:</a></strong> Custom Map Overlays Using URL Parameters</li>
                      <li><strong>Current Release:</strong> v1.2.1 <a href="#" data-section="changelog">Change Log</a></li>
                    </ul>

                    <h3>Sponsors</h3>
                    <p><a href="https://www.jawg.io/"><img src="/assets/images/logo_jawgmaps.png" style="height:40px;"></a></p>
                    <p>JawgMaps provides their vector map tiles service to XCMaps for free, i.e. the Terrain Base Map.</p>

                    <h3>Credits</h3>
                    <ul>
                      <li><strong>Base Maps:</strong> <a href="https://www.jawg.io" target="_blank">Jawg.io</a>, <a href="https://openstreetmap.org" target="_blank">OpenStreetMap</a>, <a href="https://xcontest.org" target="_blank">XContest</a>, <a href="https://maptiler.com" target="_blank">MapTiler</a></li>
                      <li><strong>Weather Stations:</strong> <a href="https://github.com/winds-mobi" target="_blank">winds.mobi</a> by Yann Savary and additional data sources</li>
                      <li><strong>Airspaces & Obstacles:</strong> <a href="https://xcontest.org" target="_blank">XContest</a>, <a href="https://openaip.net" target="_blank">OpenAIP</a></li>
                      <li><strong>Take-off and Landing Spots:</strong> © <a href="https://paraglidingspots.com" target="_blank">paraglidingspots.com</a> by Karsten Ehlers</li>
                      <li><strong>Rain Viewer:</strong> <a href="https://www.rainviewer.com" target="_blank">rainviewer</a></li>
                      <li><strong>Thermals:</strong> <a href="https://thermal.kk7.ch" target="_blank">thermal.kk7</a> by Michi von Känel</li>
                      <li>and many more open source libraries, projects, and artwork</li>
                    </ul>

                    <h3>License and Code</h3>
                    <p>As some integrations are licensed under CC BY-NC-SA 4.0, XCMaps applied the same level and is licensed under a <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank">Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License.</a></p>
                `;
            } else if (popupSections[sectionName]) {
                 contentAreaDiv.innerHTML = popupSections[sectionName];
            } else {
                 console.error("Unknown section:", sectionName); return;
            }

            footerDiv.style.display = (sectionName === 'home') ? 'flex' : 'none'; // Show footer only for home

            breadcrumbDiv.innerHTML = '';
            if (sectionName !== 'home') {
                breadcrumbDiv.innerHTML = `<a href="#" data-section="home" class="breadcrumb-link">Home</a> / `;
                const currentPageSpan = L.DomUtil.create('span', 'breadcrumb-current', breadcrumbDiv);
                if (sectionName === 'privacy') currentPageSpan.innerText = 'Privacy Policy';
                else if (sectionName === 'terms') currentPageSpan.innerText = 'Terms and Conditions';
                else if (sectionName === 'changelog') currentPageSpan.innerText = 'Change Log';
                else if (sectionName === 'airspaces') currentPageSpan.innerText = 'Airspaces';
                else if (sectionName === 'weather-stations') currentPageSpan.innerText = 'Weather Stations';
                else if (sectionName === 'live') currentPageSpan.innerText = 'LIVE!';
                else if (sectionName === 'xctrack') currentPageSpan.innerText = 'XCTrack';
            }
            contentAreaDiv.scrollTop = 0;
        }

        function showFeebackForm() {
             if (!contentAreaDiv || !footerDiv) return;
             cancelFeedback(false);
             const messageDiv = footerDiv.querySelector("#info-feedback-message");
             if (messageDiv) { messageDiv.textContent = ""; messageDiv.className = 'text-start'; }
             footerDiv.style.display = "none";

             const feedbackFormHtml = `
                <div id="infoFeedbackFormHtml" class="feedback-modal">
                    <h5>Feedback for XCMaps</h5>
                     <form id="infoFeedbackForm">
                        <div class="form-group mb-2">
                            <label for="infoFeedbackText">Feedback / Correction / Comment:</label>
                            <textarea id="infoFeedbackText" class="form-control" required style="height: 100px;"></textarea>
                        </div>
                        <div class="form-group mb-2">
                            <label>Upload Images (optional):</label>
                            <div id="infoDropzoneFeedback" class="dropzone mt-1 border-dashed rounded-2 min-h-0 dz-clickable"></div>
                        </div>
                        <div class="form-group d-flex justify-content-between mb-2">
                            <div style="width: 48%;">
                                <label for="infoUserName">Name:</label>
                                <input type="text" id="infoUserName" class="form-control" required>
                            </div>
                            <div style="width: 48%;">
                                <label for="infoUserEmail">E-Mail:</label>
                                <input type="email" id="infoUserEmail" class="form-control" required>
                                <small class="text-danger d-none" id="infoEmailError">Please enter a valid email address.</small>
                            </div>
                        </div>
                        <button type="submit" class="btn btn-sm btn-success me-2">Submit</button>
                        <button type="button" class="btn btn-sm btn-secondary info-feedback-cancel-btn">Cancel</button>
                    </form>
                </div>
             `;
             contentAreaDiv.insertAdjacentHTML("beforeend", feedbackFormHtml);
             currentFeedbackForm = contentAreaDiv.querySelector("#infoFeedbackFormHtml");

             try {
                feedbackDropzone = new Dropzone("#infoDropzoneFeedback", {
                    url: "/api/send-feedback", autoProcessQueue: false, maxFiles: 5, maxFilesize: 10,
                    acceptedFiles: "image/*", addRemoveLinks: true, dictDefaultMessage: "Drop files or click here", clickable: true,
                    init: function() { /* Optional event handlers */ }
                });
             } catch (err) { console.error("Dropzone init failed.", err); /* ... error display ... */ }

             const formElement = currentFeedbackForm?.querySelector("#infoFeedbackForm");
             const cancelButton = currentFeedbackForm?.querySelector(".info-feedback-cancel-btn");
             const emailInput = currentFeedbackForm?.querySelector("#infoUserEmail");

             if (formElement) formElement.addEventListener("submit", handleFeedbackSubmit);
             if (cancelButton) cancelButton.addEventListener("click", () => cancelFeedback(true));
             if (emailInput) {
                 emailInput.addEventListener("input", function() {
                     const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.value);
                     const errorMsg = currentFeedbackForm?.querySelector("#infoEmailError");
                     if (errorMsg) errorMsg.classList.toggle("d-none", isValid);
                 });
             }

             contentAreaDiv.scrollTop = contentAreaDiv.scrollHeight;
        }

        async function handleFeedbackSubmit(event) {
             if (!footerDiv) return;
             event.preventDefault();
             if (!currentFeedbackForm) return;
             const formData = new FormData();
             formData.append("subject", "General XCMaps Info Feedback");
             formData.append("feedbackText", currentFeedbackForm.querySelector("#infoFeedbackText").value);
             formData.append("userName", currentFeedbackForm.querySelector("#infoUserName").value);
             formData.append("userEmail", currentFeedbackForm.querySelector("#infoUserEmail").value);
             if (feedbackDropzone) {
                 feedbackDropzone.files.forEach(file => {
                     if (file.status === Dropzone.ADDED || file.status === Dropzone.QUEUED) {
                          formData.append("images", file);
                     }
                 });
             }
             try {
                 const response = await fetch(`/api/send-feedback`, { method: "POST", body: formData });
                 const result = await response.json();
                 cancelFeedback(false); // Clean form
                 const messageDiv = footerDiv.querySelector("#info-feedback-message");
                 if (messageDiv) {
                      messageDiv.textContent = result.success ? (result.message || "Feedback submitted!") : (result.error || "Submission error.");
                      messageDiv.className = result.success ? 'text-start text-success' : 'text-start text-danger';
                 }
                 // Only show footer if we are on home view after submit
                 if (!breadcrumbDiv || breadcrumbDiv.innerHTML === '') {
                    footerDiv.style.display = "flex";
                 }
             } catch (error) {
                 console.error("Submission error:", error);
                 cancelFeedback(true); // Clean form, show footer (if home)
                 const messageDiv = footerDiv.querySelector("#info-feedback-message");
                  if (messageDiv) {
                      messageDiv.textContent = "Network error during submission.";
                      messageDiv.className = 'text-start text-danger';
                  }
             }
        }

        function cancelFeedback(restoreFooter = true) {
             if (!contentAreaDiv) return;
             const formToRemove = contentAreaDiv.querySelector("#infoFeedbackFormHtml");
             if (formToRemove) formToRemove.remove();
             currentFeedbackForm = null;

             if (feedbackDropzone) {
                 if (typeof feedbackDropzone.destroy === 'function') feedbackDropzone.destroy();
                 feedbackDropzone = null;
             }
             if (restoreFooter && footerDiv) {
                 const messageDiv = footerDiv.querySelector("#info-feedback-message");
                 if(messageDiv) messageDiv.textContent = "";
                 // Only show footer if we are on the home section
                 if (!breadcrumbDiv || breadcrumbDiv.innerHTML === '') {
                    footerDiv.style.display = "flex";
                 } else {
                    footerDiv.style.display = "none";
                 }
             }
        }

         // --- Delegated Click Handler ---
         function handleContentClick(ev) {
             let target = ev.target;
             // Footer close
             if (footerDiv && footerDiv.contains(target) && target.classList.contains('info-popup-footer-close')) {
                 L.DomEvent.stopPropagation(ev);
                 if (modalOverlay && modalOverlay.style.display !== 'none') hideModal();
                 else if (typeof window.closeFullscreenInfo === 'function') {
                     const fsInfo = document.getElementById('fullScreenInfo');
                     if (fsInfo && fsInfo.classList.contains('visible')) window.closeFullscreenInfo();
                 }
                 return;
             }
             // Feedback button
             if (footerDiv && footerDiv.contains(target) && target.classList.contains('info-popup-feedback-btn')) {
                  L.DomEvent.stopPropagation(ev); showFeebackForm(); return;
             }
             // Navigation links (includes footer links)
             let depth = 0; let navTarget = target;
             while (navTarget && navTarget !== ev.currentTarget && !navTarget.dataset.section && depth < 3) {
                 navTarget = navTarget.parentNode; depth++;
             }
             if (navTarget && navTarget.dataset.section) {
                 L.DomEvent.preventDefault(ev); L.DomEvent.stopPropagation(ev);
                 updateView(navTarget.dataset.section);
             }
         }


        // --- Map Button Click Handler ---
        L.DomEvent.on(link, 'click', function(ev) {
            L.DomEvent.stop(ev);
            const screenWidthThreshold = 768;
            // Close any open instance first
            if (modalOverlay && modalOverlay.style.display !== 'none') { hideModal(); return; }
            const fsInfo = document.getElementById('fullScreenInfo');
            const fsContent = fsInfo?.querySelector('.info-popup-container');
            if (fsInfo && fsInfo.classList.contains('visible') && fsContent) {
                 if (typeof window.closeFullscreenInfo === 'function') window.closeFullscreenInfo();
                 return;
            }
            // Decide how to open
            if (window.innerWidth < screenWidthThreshold) triggerFullscreen();
            else showModal();
        });

        // --- Cleanup ---
        container.onRemove = function() {
             if (modalOverlay) { modalOverlay.remove(); modalOverlay = null; isModalStructureBuilt = false; }
             if (map) { L.DomUtil.removeClass(map.getContainer(), 'modal-open'); /* ... enable map ... */ }
        };

        return container;
    },
});
export default InfoControl;
