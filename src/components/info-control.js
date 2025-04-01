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
            home: `
                <h3>About XCmaps</h3>
                <p>XCmaps is a non-commercial project that brings together various data sources for para- and hang-gliders, providing valuable insights for the community.</p>

                <h3>Contact</h3>
                <p>You can reach out to us via the Feedback form below or by <a href="mailto:info@XCmaps.com" target="_blank">email</a>.</p>
                <p>If you’d like to report an issue, such as a bug or a feature request, please visit our <a href="https://github.com/XCmaps/XCmaps" target="_blank">GitHub</a> project page.</p>
                <p>To stay up-to date on latest updates, please follow us on <a href="https://facebook.com/xcmaps" target="_blank">Facebook</a> or <a href="https://github.com/XCmaps/XCmaps" target="_blank">GitHub</a>.</p>

                <p>If you enjoy our content, consider buying us a landing beer! Your support helps keep this service running, as we cover real costs for servers, storage, AI models, and data sources.<br>It’s simple: the more funding we receive, the faster we can roll out new features!</p>
                <p><a href="https://buymeacoffee.com/XCmaps" target="_blank" class="donation-button"> 🍺 Buy us a Landing Beer</a></p>

                <h3>Features</h3>
                <ul>
                  <li><strong>Weather Stations:</strong> Wind, Gusts, Direction, Temp and Camera if available</li>
                  <li><strong>Rain Viewer:</strong> Radar and Satellite incl. forecast</li>
                  <li><strong>Thermals:</strong> kk7 thermal map</li>
                  <li><strong>Spots:</strong> Para- and Hangliding take-off and Landing Zones (© <a href="https://paraglidingspots.com" target="_blank">paraglidingspots.com</a>)</li>
                  <li><strong>Airspaces:</strong> Xcontest Airspaces & Activations, filter for today and the next 6 days and lowest floor level</li>
                  <li><strong>Obstacles:</strong> OSM based obstacles from Xcontest</li>
                </ul>

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
                <p>As some integrations are licensed under CC BY-NC-SA 4.0, XCmaps applied the same level and is licensed under a <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank">Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License.</a></p>
            `,
            privacy: `
                <h3>XCmaps Privacy Policy</h3>
                <p>At XCmaps (referred to as "we", "us" or "our" in this policy), we understand the importance of protecting your personal data. This privacy policy explains how we collect, use, share and store information when you access our website at XCmaps.com, which is operated by us, and any other services provided by flyXC (collectively referred to as the "Services").</p>
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
                <p>We collect your registered tracker positions continuously and use that to display your position on the map for up to 48 hours. By signing up for XCmaps and registering your tracker devices, you acknowledge and agree that your tracker devices location will be displayed and viewable via our services.</p>
                <p>For safety purpose, we keep an archive of the last 30 days for the live tracks. The archive is not publicly accessible.</p>
                <p>We reserve the right to use any track uploaded on our services. i.e. to derive heat maps of thermal locations.</p>
                <h4>3. How We Use Information</h4>
                <p>We use your information to:</p>
                <ul><li>Provide and improve our products and services;</li><li>Respond to requests, inquiries, and comments;</li><li>Analyze usage trends and preferences;</li><li>Comply with legal obligations;</li><li>Enforce our terms of service;</li><li>Protect the rights, property, or safety of XCmaps, our users, or others.</li></ul>
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
                <p>If you have any questions about this Privacy Policy, please contact us at: info@XCmaps.com</p>
            `,
            terms: `
                <h3>XCmaps Terms and Conditions</h3>
                <p>This website, XCmaps.com (the "Website"), provides various data sources for para- and hang-gliders, providing valuable insights for the community.</p>
                <p>By using the Website, you agree to these terms and conditions (the "Terms") and acknowledge that they constitute a legally binding contract between you and XCmaps. If you do not agree to these Terms, please do not use the Website. We reserve the right to modify or update these Terms at any time without prior notice. Your continued use of the Website after any changes indicates your acceptance of the new terms and conditions. Therefore, we recommend that you review these Terms regularly for any changes.</p>

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
                <p>XCmaps does not collect data from its users.</p>
                <p>XCmaps does not sell, rent, or otherwise share your personal information with any third parties, except as required by law or as necessary to protect the rights, property, or safety of XCmaps, its employees, users, or others. XCmaps may also disclose your data if it is involved in a merger, acquisition, or sale of all or part of its assets.</p>

                <h4>3. Ownership and Intellectual Property Rights</h4>
                <p>The Website, including but not limited to its design, layout, content, graphics, images, audio, video, and code, is owned by XCmaps and protected by copyright laws and international intellectual property rights. You may not reproduce, modify, distribute, sell, or otherwise use any part of the Website without the prior written consent of XCmaps.</p>

                <h4>4. Disclaimer of Warranties and Liability</h4>
                <p>The Website is provided "as is" and "as available". XCmaps disclaims all warranties, express or implied, including but not limited to warranties of merchantability, fitness for a particular purpose, title, non-infringement, and security. XCmaps does not guarantee that the Website will be error-free, uninterrupted, or accessible at all times. XCmaps is not responsible for any losses, damages, or expenses arising from your use of the Website, including but not limited to direct, indirect, special, incidental, consequential, or punitive damages. XCmaps also disclaims any liability for any actions taken by you or others based on the information provided by the Website, which may be inaccurate, incomplete, or outdated.</p>

                <h4>5. Indemnification</h4>
                <p>You agree to indemnify and hold harmless XCmaps, its officers, directors, employees, agents, licensors, and suppliers from any claims, actions, demands, liabilities, costs, damages, and expenses (including reasonable attorneys' fees) arising from your use of the Website or your violation of these Terms.</p>

                <h4>6. Applicable Law and Dispute Resolution</h4>
                <p>These Terms shall be governed by and construed in accordance with the laws of France, without giving effect to any principles of conflicts of law. Any disputes arising out of or in connection with these Terms or your use of the Website shall be subject to the exclusive jurisdiction of the courts of England and Wales.</p>

                <h4>7. Entire Agreement</h4>
                <p>These Terms constitute the entire agreement between you and XCmaps regarding your use of the Website and supersede any prior agreements, understandings, or representations, whether written or oral. If any provision of these Terms is found to be unenforceable or invalid, that provision shall be limited or eliminated to the minimum extent necessary so that these Terms shall otherwise remain in full force and effect and enforceable.</p>
                <p>By using the Website, you acknowledge that you have read, understood, and agreed to these Terms. If you do not agree to these Terms, please do not use the Website.</p>
            `
        };

        // --- Function to build the common content structure ---
        function buildContentStructure() {
            const structureContainer = L.DomUtil.create('div', 'info-popup-container');

            headerDiv = L.DomUtil.create('div', 'info-popup-header', structureContainer); // Main header flex container

            // Left side: Logo and Breadcrumbs
            const headerLeft = L.DomUtil.create('div', 'info-popup-header-left', headerDiv);
            const logoImg = L.DomUtil.create('img', 'info-popup-logo', headerLeft);
            logoImg.src = 'assets/images/XCmapsLogo.png';
            logoImg.alt = 'XCmaps Logo';
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
            ghLink.href = 'https://github.com/XCmaps/XCmaps'; 
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
            if (!popupSections[sectionName]) { console.error("Unknown section:", sectionName); return; }
            contentAreaDiv.innerHTML = popupSections[sectionName];
             footerDiv.style.display = (sectionName === 'home') ? 'flex' : 'none';

            breadcrumbDiv.innerHTML = '';
            if (sectionName !== 'home') {
                breadcrumbDiv.innerHTML = `<a href="#" data-section="home" class="breadcrumb-link">Home</a> / `;
                const currentPageSpan = L.DomUtil.create('span', 'breadcrumb-current', breadcrumbDiv);
                if (sectionName === 'privacy') currentPageSpan.innerText = 'Privacy Policy';
                else if (sectionName === 'terms') currentPageSpan.innerText = 'Terms and Conditions';
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
                    <h5>Feedback for XCmaps</h5>
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
             formData.append("subject", "General XCmaps Info Feedback");
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
