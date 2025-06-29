// spotsHelper.js - Common functionality for loading and displaying spots on a map
import { keycloak, isUserAuthenticated } from './keycloak-auth.js';

// Module-scoped variable to track Dropzone instance
let feedbackDropzone = null;
let currentFeedbackForm = null;

// Swiper related functions
function changeSwiper() {
    if (typeof swiperc !== "undefined") {
        if (window.innerWidth < 576) {
            $(".swiper2").css("height", ""); $(".swiper2").css("width", "320px");
            $(".swiper2").css("padding-left", ""); $(".swiper2").css("padding-top", "30px");
            $(".swiper2 > .swiper-wrapper").css("width", ""); $(".swiper2 > .swiper-wrapper").css("height", "100px");
            swiperc.changeDirection('horizontal', true);
        }
        else {
            if (window.innerWidth < 840) {
                $(".swiper2").css("width", ""); $(".swiper2").css("height", "320px");
            }
            else {
                $(".swiper2").css("width", ""); $(".swiper2").css("height", "460px");
            }
            $(".swiper2").css("padding-top", ""); $(".swiper2").css("padding-left", "30px");
            $(".swiper2 > .swiper-wrapper").css("height", ""); $(".swiper2 > .swiper-wrapper").css("width", "100px");
            swiperc.changeDirection('vertical', true);
        }
    }
}

function initSwiper(idImg) {
    let swiperv, swiperc;
    // USED 09/24 Beschreibung: Initialisierung der Image-Swiper
    var swiperLoop3 = (idImg < 4) ? false : true;
    var swiperLoop4 = (idImg < 5) ? false : true;

    swiperv = new Swiper('.swiper1', {
        autoHeight: true,
        direction: 'horizontal',
        allowTouchMove: false,
        mousewheel: false,
        slidesPerView: 1,
        loop: false,
    });

    swiperc = new Swiper('.swiper2', {
        direction: 'vertical',
        allowTouchMove: true,
        mousewheel: true,
        slidesPerView: 3,
        spaceBetween: 10,
        loop: swiperLoop3,
        breakpoints: {
            840: {
                slidesPerView: 4,
                loop: swiperLoop4
            }
        },
        scrollbar: {
            el: '.swiper-scrollbar',
            hide: false,
            draggable: true,
        },
        on: {
            click: function() {
                let iR = (this.clickedSlide.firstChild.id).substring(3) - 1;
                swiperv.slideTo(iR, 1);
            },
            transitionEnd: function () {
                let iR = this.realIndex;
                swiperv.slideTo(iR, 1);
            }
        }
    });

    changeSwiper();
}

// Mapping wind directions to angles
function getAngleRange(direction) {
    const dirToAngle = {
        "N": 0, "NNE": 22.5, "NE": 45, "ENE": 67.5,
        "E": 90, "ESE": 112.5, "SE": 135, "SSE": 157.5,
        "S": 180, "SSW": 202.5, "SW": 225, "WSW": 247.5,
        "W": 270, "WNW": 292.5, "NW": 315, "NNW": 337.5
    };

    let angleRanges = [];
    let parts = direction.split(',').map(part => part.trim());

    parts.forEach(part => {
        let range = part.split('-').map(dir => dir.trim());
        if (range.length === 1) {
            let angle = dirToAngle[range[0]];
            if (angle !== undefined) {
                angleRanges.push([angle - 22.5, angle + 22.5]);
            }
        } else if (range.length === 2) {
            let start = dirToAngle[range[0]];
            let end = dirToAngle[range[1]];
            if (start !== undefined && end !== undefined) {
                if (end < start) {
                    [start, end] = [end, start];
                }
                if (end - start > 180) {
                    [start, end] = [end, start];
                }
                angleRanges.push([start, end]);
            }
        }
    });

    return angleRanges;
}
 
/**
 * Translates specific properties of spotData using the backend translation service.
 * Modifies spotData.properties in place.
 * @param {object} spotData - The spot data object, expected to have a .properties child object.
 */
async function translateSpotProperties(spotData) {
    if (!spotData || !spotData.properties) {
        console.warn("translateSpotProperties: Invalid spotData or missing properties.");
        return;
    }
 
    const propertiesToTranslate = [
        "site_type",
        "suitability_hg",
        "suitability_pg",
        "requirements",
        "site_remarks",
        "access_remarks",
        "site_information"
    ];
 
    const textsToTranslateMap = []; // To store { key, originalText }
 
    for (const key of propertiesToTranslate) {
        if (spotData.properties[key] && typeof spotData.properties[key] === 'string' && spotData.properties[key].trim() !== "") {
            textsToTranslateMap.push({ key, originalText: spotData.properties[key] });
        }
    }
 
    if (textsToTranslateMap.length === 0) {
        // console.log("translateSpotProperties: No text found to translate.");
        return; // No text to translate
    }
 
    const textsArray = textsToTranslateMap.map(item => item.originalText);
    const browserLang = navigator.language || 'en'; // Default to 'en' if navigator.language is not available
 
    try {
        console.log(`[Spots-Helper] Requesting translation for ${textsArray.length} texts to ${browserLang}`);
        const response = await fetch('/api/translate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                texts: textsArray,
                targetBrowserLang: browserLang,
            }),
        });
 
        if (!response.ok) {
            const errorBody = await response.text();
            console.error(`[Spots-Helper] Translation API request failed: ${response.status}`, errorBody);
            return; // Do not modify original texts on error
        }
 
        const result = await response.json();
 
        if (result.translatedTexts && Array.isArray(result.translatedTexts) && result.translatedTexts.length === textsToTranslateMap.length) {
            result.translatedTexts.forEach((translatedText, index) => {
                const originalItem = textsToTranslateMap[index];
                if (translatedText && typeof translatedText === 'string' && translatedText.trim() !== "") {
                    spotData.properties[originalItem.key] = translatedText;
                } else {
                    // If translation is null or empty, keep original (or decide on other behavior)
                    // console.warn(`[Spots-Helper] Received null or empty translation for ${originalItem.key}, keeping original.`);
                }
            });
            console.log("[Spots-Helper] Spot properties updated with translations.");
        } else {
            console.error("[Spots-Helper] Translation API response format error or mismatched counts:", result);
        }
    } catch (error) {
        console.error("[Spots-Helper] Error calling translation API:", error);
        // On error, original texts remain unchanged
    }
}
 
// Fetch full place details when a popup is opened
async function loadPlaceDetails(layer, placeId) {
    try {
        const response = await fetch(`/api/places/${placeId}`);
        const data = await response.json();

        if (data.error) {
            console.error("Error fetching place details:", data.error);
            return;
        }

        let regex1 = /<center><b><a href="http:\/\/www\.paraglidingearth\.com\/index\.php\?site=\d+">More information on ParaglidingEarth<\/a><\/b><\/center>\n?/g;
        let regex2 = /<br>\n<b>Take off : <\/b><br>\n?/g;
        let regexHeight = /H \d+(-\d+)? m(?:, |<br>)/g;
        let regexHD = /HD \d+ m(?:<br>| \/)/g;
        let regexRating = /\nrating \d+\/\d+(?:\n|<br>)*/gi;

        let description = (data.properties.description || "")
            .replace(regex1, "")
            .replace(regex2, "")
            .replace(regexHeight, "")
            .replace(regexHD, "")
            .replace(regexRating, "")
            .trim();
 
        // Attempt to translate relevant properties before using them
        // data.properties will be modified in place if translations are successful
        await translateSpotProperties(data);
 
        window.currentPlaceName = data.properties.name;
        window.currentPlaceId = data.properties.id;
        window.currentStrPlacemarkId = data.properties.strPlacemarkId;

        // --- Apply fullSpotsPopoup configuration ---
        const userHasRole = keycloak && isUserAuthenticated() && keycloak.hasRealmRole('fullSpotsPopoup');

        // --- Apply DhvSpotsPopoup configuration ---
        if (data.properties.dhv_id != null) { // First, check if it's a DHV-potential spot
            console.log("spots-helper.js: Detected spot with dhv_id, processing as potential DHV popup.");
            const screenWidthThreshold = 768; // Match CSS media query from index.js
            let popupContent = `<span style="color: #0087F7;"><h5>${data.properties.name}</h5></span>
                              <table style="border-collapse: collapse; width: 100%;">`;

            if (data.properties.site_type != null) {
                popupContent += `<tr>
                                    <th style="text-align: left; vertical-align: top; width: 30%;">Suitability:</th>
                                    <td style="text-align: left; vertical-align: top;">${data.properties.site_type}</td>
                                 </tr>`;
            }
            if (data.properties.altitude != null) {
                popupContent += `<tr>
                                    <th style="text-align: left; vertical-align: top;">Altitude:</th>
                                    <td style="text-align: left; vertical-align: top;">${data.properties.altitude} m</td>
                                 </tr>`;
            }
            if (data.properties.height_difference_max != null) {
                popupContent += `<tr>
                                    <th style="text-align: left; vertical-align: top;">Height Difference:</th>
                                    <td style="text-align: left; vertical-align: top;">${data.properties.height_difference_max} m</td>
                                 </tr>`;
            }
            if (data.properties.de_certification_holder != null) {
                popupContent += `<tr>
                                    <th style="text-align: left; vertical-align: top;">Site Owner:</th>
                                    <td style="text-align: left; vertical-align: top;">${data.properties.de_certification_holder}</td>
                                 </tr>`;
            }
            if (data.properties.site_contact != null) {
                popupContent += `<tr>
                                    <th style="text-align: left; vertical-align: top;">Site Contact:</th>
                                    <td style="text-align: left; vertical-align: top;">${data.properties.site_contact}</td>
                                 </tr>`;
            }
            if (data.properties.site_information != null) {
                popupContent += `<tr>
                                    <th style="text-align: left; vertical-align: top;">Site Information:</th>
                                    <td style="text-align: left; vertical-align: top;">${data.properties.site_information}</td>
                                 </tr>`;
            }
            if (data.properties.site_remarks != null) {
                popupContent += `<tr>
                                    <th style="text-align: left; vertical-align: top;">Site Remarks:</th>
                                    <td style="text-align: left; vertical-align: top;">${data.properties.site_remarks}</td>
                                 </tr>`;
            }
            if (data.properties.paragliding != null || data.properties.suitability_pg != null) {
                popupContent += `<tr>
                                    <th style="text-align: left; vertical-align: top;">Paragliding:</th>
                                    <td style="text-align: left; vertical-align: top;">${data.properties.paragliding ? 'Yes' : 'No'}${data.properties.suitability_pg ? ' (' + data.properties.suitability_pg + ')' : ''}</td>
                                 </tr>`;
            }
            if (data.properties.hanggliding != null || data.properties.suitability_hg != null) {
                popupContent += `<tr>
                                    <th style="text-align: left; vertical-align: top;">Hang gliding:</th>
                                    <td style="text-align: left; vertical-align: top;">${data.properties.hanggliding ? 'Yes' : 'No'}${data.properties.suitability_hg ? ' (' + data.properties.suitability_hg + ')' : ''}</td>
                                 </tr>`;
            }
            if (data.properties.weather_info != null) {
                popupContent += `<tr>
                                    <th style="text-align: left; vertical-align: top;">Weather Info:</th>
                                    <td style="text-align: left; vertical-align: top;"><a href="${data.properties.weather_info}" target="_blank">${data.properties.weather_info}</a></td>
                                 </tr>`;
            }
            if (data.properties.cable_car != null) {
                popupContent += `<tr>
                                    <th style="text-align: left; vertical-align: top;">Cable Car:</th>
                                    <td style="text-align: left; vertical-align: top;">${data.properties.cable_car}</td>
                                 </tr>`;
            }

            let accessInfo = [];
            if (data.properties.access_by_car) accessInfo.push("Car: Yes");
            if (data.properties.access_by_public_transport) accessInfo.push("Public Transport: Yes");
            if (data.properties.access_by_foot) accessInfo.push("Foot: Yes");
            if (accessInfo.length > 0) {
                 popupContent += `<tr>
                                    <th style="text-align: left; vertical-align: top;">Access:</th>
                                    <td style="text-align: left; vertical-align: top;">${accessInfo.join(', ')}</td>
                                 </tr>`;
            }

            if (data.properties.access_remarks != null) {
                popupContent += `<tr>
                                    <th style="text-align: left; vertical-align: top;">Access remarks:</th>
                                    <td style="text-align: left; vertical-align: top;">${data.properties.access_remarks}</td>
                                 </tr>`;
            }
            if (data.properties.requirements != null) {
                popupContent += `<tr>
                                    <th style="text-align: left; vertical-align: top;">Requirements:</th>
                                    <td style="text-align: left; vertical-align: top;"><div style="white-space: pre-wrap;">${data.properties.requirements}</div></td>
                                 </tr>`;
            }
            if (data.properties.site_url != null) {
                popupContent += `<tr>
                                    <th style="text-align: left; vertical-align: top;">Link to DHV Site Page:</th>
                                    <td style="text-align: left; vertical-align: top;"><a href="${data.properties.site_url}" target="_blank">${data.properties.site_url}</a></td>
                                 </tr>`;
            }

            popupContent += `</table><br>
                             <b>© <a href="https://www.dhv.de" target="_blank">DHV</a></b>
                             <div class="modal-footer d-flex justify-content-between">
                             <div id="feedback-message" class="text-start"></div> <!-- Message on the left -->
                             <div class="d-flex ms-auto">
                                 <button class="btn btn-primary btn-sm me-2" onclick="showFeebackForm()">Feedback/Correction</button>
                                 <button class="btn btn-dark btn-sm close-popup">Close</button>
                             </div>
                             </div>
                             `;
            
            popupContent += `<style>
            .leaflet-popup-content { max-width: 600px !important; } /* Adjust DHV popup width */
            .spot-description { max-height: 200px; overflow-y: auto; white-space: pre-wrap; }
            /* Limit the height of the Swiper container */
            .swiper-container {
                max-height: 460px !important;
                height: 460px !important;
                overflow: hidden !important;
            }

            /* Ensure individual Swipers don't expand beyond this height */
            .swiper, .swiper1, .swiper2 {
                max-height: 460px !important;
                height: 460px !important;
                overflow: hidden !important;
            }

            /* Limit Swiper wrapper height */
            .swiper-wrapper {
                max-height: 460px !important;
            }

            /* Ensure Swiper slides don't stretch */
            .swiper-slide {
                max-height: 460px !important;
                display: flex !important;
                align-items: center !important; /* Keep images centered */
                justify-content: center !important;
            }

            /* Prevent images from exceeding the swiper height */
            .swiper-slide img {
                max-height: 100% !important;
                width: auto !important;
            }
            
            /* Keep the overall popup size unchanged */
            .leaflet-popup-content {
                max-height: 780px !important; /* Keep original popup height */
                overflow-y: auto; /* Allow scrolling inside the popup if needed */
            }

            .swiper-clear {
                clear: both;
                margin-bottom: 1px;
            }
            </style>`;

            let madeFullscreenBySpotsHelper = false;
            // Check DHV config and screen size to proactively trigger fullscreen
            if (window.appConfig && window.appConfig.DhvSpotsPopoup === true && window.innerWidth < screenWidthThreshold) {
                console.log("spots-helper.js: DHV spot, DhvSpotsPopoup is true, and small screen. Calling showInFullscreen.");
                window.showInFullscreen(popupContent); // This function (in index.js) closes the small popup.
                madeFullscreenBySpotsHelper = true;
            }

            // If not made fullscreen by spots-helper (e.g. large screen or DhvSpotsPopoup is false),
            // set content for the regular Leaflet popup.
            if (!madeFullscreenBySpotsHelper) {
                layer.setPopupContent(popupContent);
            }

            // Add 'dhv-spot-popup' class to the popup element if it exists.
            // This is useful if it didn't go fullscreen, or for styling the fullscreen content later.
            const currentPopup = layer.getPopup();
            if (currentPopup && currentPopup.getElement()) {
                currentPopup.getElement().classList.add('dhv-spot-popup');
                console.log("spots-helper.js: Added 'dhv-spot-popup' class to popup element.");
            }
            
            // Handle content update if fullscreen was ALREADY visible (e.g., by a generic rule in index.js)
            // and spots-helper itself didn't just make it fullscreen.
            const fullScreenInfo = document.getElementById('fullScreenInfo');
            const fullScreenContentArea = document.getElementById('fullscreen-content-area');
            if (fullScreenInfo && fullScreenInfo.classList.contains('visible') && fullScreenContentArea) {
                if (!madeFullscreenBySpotsHelper) {
                    // Fullscreen was visible due to other reasons (e.g. index.js fullSpotsPopup=true generic rule)
                    // Now we know it's DHV, so update its content and remove default buttons.
                    console.log("spots-helper.js: Fullscreen was already visible (not by spots-helper). Updating content for DHV.");
                    const defaultCloseBtn = fullScreenInfo.querySelector('#default-fullscreen-close-btn');
                    const defaultFooter = fullScreenInfo.querySelector('#default-fullscreen-footer');
                    if (defaultCloseBtn) defaultCloseBtn.remove();
                    if (defaultFooter) defaultFooter.remove();
                    fullScreenContentArea.innerHTML = popupContent; // Update with DHV specific content
                } else {
                    // spots-helper just made it fullscreen. The content is set by showInFullscreen.
                    // We need to ensure our custom DHV buttons (from popupContent) are used,
                    // instead of generic ones showInFullscreen might add.
                    // showInFullscreen in index.js adds its own default close/footer. We need to remove those
                    // as popupContent (passed to showInFullscreen) already has the correct DHV footer/buttons.
                    console.log("spots-helper.js: Fullscreen triggered by spots-helper. Ensuring DHV buttons are primary.");
                    const defaultCloseBtn = fullScreenInfo.querySelector('#default-fullscreen-close-btn');
                    const defaultFooter = fullScreenInfo.querySelector('#default-fullscreen-footer');
                    if (defaultCloseBtn) defaultCloseBtn.remove(); // Remove default added by showInFullscreen
                    if (defaultFooter) defaultFooter.remove();   // Remove default added by showInFullscreen
                    // The `popupContent` was passed to showInFullscreen, which should have placed it in `fullscreen-content-area`.
                    // The setTimeout for button listeners below will attach to buttons within this `popupContent`.
                }
            }
 
            setTimeout(() => {
                let firstImg = document.querySelector(".swiper1 .swiper-slide img");
                if (firstImg) {
                    let idImg = parseInt(firstImg.id.replace(/\D/g, ""), 10) || 1;
                    initSwiper(idImg);
                }
            }, 300);
            
            setTimeout(() => {
                const fullScreenInfo = document.getElementById('fullScreenInfo');
                let closeButton = null;

                if (fullScreenInfo && fullScreenInfo.classList.contains('visible')) {
                    closeButton = fullScreenInfo.querySelector('#fullscreen-content-area .close-popup');
                    if (closeButton) {
                        closeButton.replaceWith(closeButton.cloneNode(true));
                        closeButton = fullScreenInfo.querySelector('#fullscreen-content-area .close-popup');
                        closeButton.addEventListener("click", function () {
                            window.closeFullscreenInfo();
                        });
                    }
                } else {
                    const popupElement = layer.getPopup()?.getElement();
                    if (popupElement) {
                        closeButton = popupElement.querySelector(".close-popup");
                        if (closeButton) {
                            closeButton.replaceWith(closeButton.cloneNode(true));
                            closeButton = popupElement.querySelector(".close-popup");
                            closeButton.addEventListener("click", function () {
                                if (window.map) { window.map.closePopup(); }
                            });
                        }
                    }
                }
            }, 350);


        } else if (window.appConfig && (window.appConfig.fullSpotsPopoup === true || userHasRole)) {
            // --- FULL POPUP LOGIC ---
            if (userHasRole && window.appConfig.fullSpotsPopoup === false) {
                console.log("Generating full spot popup (user role override)");
            } else {
                console.log("Generating full spot popup (config enabled)");
            }

            let popupContent = `<span style="color: #0087F7;"><h5>${data.properties.name}</h5></span>
                                <table style="border-collapse: collapse; width: 70%;">
                                <tr>
                                    <th style="text-align: left; vertical-align: top;">Type:</th>
                                    <td style="text-align: left; vertical-align: top;">${data.properties.type}</td>
                                </tr>
                                <tr>
                                    <th style="text-align: left; vertical-align: top;">Direction:</th>
                                    <td style="text-align: left; vertical-align: top;">${data.properties.direction}</td>
                                </tr>
                                <tr>
                                    <th style="text-align: left; vertical-align: top;">Rating:</th>
                                    <td style="text-align: left; vertical-align: top;">${data.properties.rating != null ? data.properties.rating + '/6' : ' -'}</td>
                                </tr>
                                <tr>
                                    <th style="text-align: left; vertical-align: top;">Height:</th>
                                    <td style="text-align: left; vertical-align: top;">${data.properties.height != null ? data.properties.height : ' -'}</td>
                                </tr>
                                <tr>
                                    <th style="text-align: left; vertical-align: top;">Height difference:</th>
                                    <td style="text-align: left; vertical-align: top;">${data.properties.heightdifference != null ? data.properties.heightdifference : ' -'}</td>
                                </tr>
                                <tr>
                                    <th style="text-align: left; vertical-align: top;">Last Update:</th>
                                    <td style="text-align: left; vertical-align: top;">${data.properties.lastupdate}</td>
                                </tr>
                                </table><br>
                                <b>Description:</b> <div class="spot-description">${description}</div><br>
                                <b>© <a href="https://paraglidingspots.com" target="_blank">paraglidingspots.com</a></b>
                                <div class="modal-footer d-flex justify-content-between">
                                <div id="feedback-message" class="text-start"></div> <!-- Message on the left -->
                                <div class="d-flex ms-auto">
                                    <button class="btn btn-primary btn-sm me-2" onclick="showFeebackForm()">Feedback/Correction</button>
                                    <button class="btn btn-dark btn-sm close-popup">Close</button>
                                </div>
                                </div>
                                `;

            // Apply maxWidth CSS directly to popup content if needed
            popupContent += `<style>
            /* Limit the height of the Swiper container */
            .swiper-container {
                max-height: 460px !important;
                height: 460px !important;
                overflow: hidden !important;
            }

            /* Ensure individual Swipers don't expand beyond this height */
            .swiper, .swiper1, .swiper2 {
                max-height: 460px !important;
                height: 460px !important;
                overflow: hidden !important;
            }

            /* Limit Swiper wrapper height */
            .swiper-wrapper {
                max-height: 460px !important;
            }

            /* Ensure Swiper slides don't stretch */
            .swiper-slide {
                max-height: 460px !important;
                display: flex !important;
                align-items: center !important; /* Keep images centered */
                justify-content: center !important;
            }

            /* Prevent images from exceeding the swiper height */
            .swiper-slide img {
                max-height: 100% !important;
                width: auto !important;
            }
            
            /* Keep the overall popup size unchanged */
            .leaflet-popup-content {
                max-height: 780px !important; /* Keep original popup height */
                overflow-y: auto; /* Allow scrolling inside the popup if needed */
            }

            .swiper-clear {
                clear: both;
                margin-bottom: 1px;
            }
            </style>`;

            // Check if fullscreen info is visible and update its content area
            // Note: The actual showing/hiding of fullscreen is handled by index.js popupopen handler
            // This part just ensures the content is ready if fullscreen is triggered.
            const fullScreenInfo = document.getElementById('fullScreenInfo');
            const fullScreenContentArea = document.getElementById('fullscreen-content-area');
            if (fullScreenInfo && fullScreenInfo.classList.contains('visible') && fullScreenContentArea) {
                console.log("Updating fullscreen info content area for spot (config enabled)");
                // Remove default button/footer added by index.js
                const defaultCloseBtn = fullScreenInfo.querySelector('#default-fullscreen-close-btn');
                const defaultFooter = fullScreenInfo.querySelector('#default-fullscreen-footer');
                if (defaultCloseBtn) defaultCloseBtn.remove();
                if (defaultFooter) defaultFooter.remove();
                // Set the spot-specific content
                fullScreenContentArea.innerHTML = popupContent;
            }

            // Update the original Leaflet popup
            layer.setPopupContent(popupContent);

            // Wait for the popup to open before initializing Swiper
            setTimeout(() => {
                let firstImg = document.querySelector(".swiper1 .swiper-slide img");
                if (firstImg) {
                    let idImg = parseInt(firstImg.id.replace(/\D/g, ""), 10) || 1;
                    initSwiper(idImg); // Call existing Swiper function
                }
            }, 300);

            // Attach close button listener, considering fullscreen context
            setTimeout(() => {
                const fullScreenInfo = document.getElementById('fullScreenInfo');
                let closeButton = null;

                if (fullScreenInfo && fullScreenInfo.classList.contains('visible')) {
                    // Target close button within fullscreen view
                    closeButton = fullScreenInfo.querySelector('#fullscreen-content-area .close-popup');
                    if (closeButton) {
                        closeButton.replaceWith(closeButton.cloneNode(true)); // Remove old listeners
                        closeButton = fullScreenInfo.querySelector('#fullscreen-content-area .close-popup'); // Re-select
                        closeButton.addEventListener("click", function () {
                            console.log("Fullscreen close button clicked");
                            window.closeFullscreenInfo();
                        });
                    } else { console.error("Close button not found in fullscreen view"); }
                } else {
                    // Target close button within the standard Leaflet popup
                    const popupElement = layer.getPopup()?.getElement();
                    if (popupElement) {
                        closeButton = popupElement.querySelector(".close-popup");
                        if (closeButton) {
                            closeButton.replaceWith(closeButton.cloneNode(true)); // Remove old listeners
                            closeButton = popupElement.querySelector(".close-popup"); // Re-select
                            closeButton.addEventListener("click", function () {
                                console.log("Standard popup close button clicked");
                                if (window.map) { window.map.closePopup(); }
                            });
                        } else { console.error("Close button not found in standard popup"); }
                    }
                }
            }, 350);

        } else {
            // --- SIMPLIFIED POPUP LOGIC ---
            console.log("Generating simplified spot popup (config disabled and no role override)");

            // Add the 'simplified-spot-popup' class here
            const simplifiedPopupContent = `
                <div class="simplified-spot-popup" style="padding: 5px;">
                    <span style="color: #0087F7;"><h5>${data.properties.name}</h5></span>
                    <p style="font-size: 0.9em; margin-top: 10px;">
                        All Spots are provided under the copyright of paraglidingspots.com.
                        If you want to see the full details for this spot, please visit
                        <a href="https://paraglidingspots.com/online/" target="_blank" rel="noopener noreferrer">https://paraglidingspots.com/online/</a>
                    </p>
                    <b>© <a href="https://paraglidingspots.com" target="_blank">paraglidingspots.com</a></b>
                </div>
            `;
            // Set the simplified content for the standard Leaflet popup
            layer.setPopupContent(simplifiedPopupContent);

            // Ensure fullscreen is closed if it was somehow opened
            const fullScreenInfo = document.getElementById('fullScreenInfo');
             if (fullScreenInfo && fullScreenInfo.classList.contains('visible')) {
                 window.closeFullscreenInfo();
             }
        }
        // --- End configuration application ---

    } catch (error) {
        console.error("Error fetching place details:", error);
    }
}

function showFeebackForm() {
    // Cleanup any existing feedback form
    if (currentFeedbackForm) {
        currentFeedbackForm.remove();
        currentFeedbackForm = null;
    }
    if (feedbackDropzone) {
        feedbackDropzone.destroy();
        feedbackDropzone = null;
    }
    // Clear previous feedback message
    const messageDiv = document.getElementById("feedback-message");
    if (messageDiv) {
        messageDiv.textContent = "";
         messageDiv.classList.remove("text-success", "text-danger");
    }

    // Determine the context (fullscreen or standard popup)
    const fullScreenInfo = document.getElementById('fullScreenInfo');
    const isFullScreen = fullScreenInfo && fullScreenInfo.classList.contains('visible');
    const contextElement = isFullScreen ? fullScreenInfo.querySelector('#fullscreen-content-area') : document.querySelector(".leaflet-popup-content");

    if (!contextElement) {
        console.error("Could not find context element for feedback form.");
        return;
    }

    // Hide the original footer within the correct context
    let modalFooter = contextElement.querySelector(".modal-footer");
    if (modalFooter) modalFooter.style.display = "none";

    const feedbackFormHtml = `
        <div id="feedbackFormHtml">
            <div class="feedback-modal">
                <span style="color: #0087F7;"><h5>Feedback for ${window.currentPlaceName}</h5></span>
                <form id="feedbackForm">
                    <div class="form-group">
                        <label for="feedbackText">Feedback / Correction / Comment:</label>
                        <textarea id="feedbackText" class="form-control" required style="height: 130px;"></textarea>
                    </div>
                    <div class="form-group">
                        <label>Upload Images (optional):</label>
                        <div id="dropzoneFeedback" class="dropzone mt-4 border-dashed rounded-2 min-h-0"></div>
                    </div>
                    <div class="form-group d-flex justify-content-between">
                        <div style="width: 48%;">
                            <label for="userName">Name:</label>
                            <input type="text" id="userName" class="form-control" required>
                        </div>
                        <div style="width: 48%;">
                            <label for="userEmail">E-Mail:</label>
                            <input type="email" id="userEmail" class="form-control" required>
                            <small class="text-danger d-none" id="emailError">Please enter a valid email address.</small>
                        </div>
                    </div>
                    <button type="submit" class="btn btn-sm btn-success">Submit</button>
                    <button type="button" class="btn btn-sm btn-secondary" onclick="cancelFeedback()">Cancel</button>
                </form>
            </div>
        </div>
    `;

    // Append the form HTML to the correct context element
    if (contextElement) {
        contextElement.insertAdjacentHTML("beforeend", feedbackFormHtml);
        // Find the newly added form within the specific context
        currentFeedbackForm = contextElement.querySelector("#feedbackFormHtml");

        // Auto-scroll implementation (scroll the context element)
        setTimeout(() => {
            // Use the contextElement determined earlier
            if (contextElement) {
                // First try the standard scrollTo method
                contextElement.scrollTo({
                    top: contextElement.scrollHeight,
                    behavior: 'smooth'
                });
                
                // As a fallback, also set scrollTop directly
                contextElement.scrollTop = contextElement.scrollHeight;
                
                // If we're in fullscreen mode, also try to scroll the entire fullscreen container
                if (isFullScreen && fullScreenInfo) {
                    fullScreenInfo.scrollTo({
                        top: fullScreenInfo.scrollHeight,
                        behavior: 'smooth'
                    });
                    fullScreenInfo.scrollTop = fullScreenInfo.scrollHeight;
                }
                
                // Focus on the feedback text area to bring it into view
                setTimeout(() => {
                    const feedbackText = document.getElementById("feedbackText");
                    if (feedbackText) {
                        feedbackText.focus();
                    }
                }, 100);
            }
        }, 200); // Increased delay to ensure DOM rendering
    } else {
        console.error("Popup content not found!");
        return;
    }

    // Initialize Dropzone
    feedbackDropzone = new Dropzone("#dropzoneFeedback", {
        url: "/upload",
        autoProcessQueue: false,
        maxFiles: 5,
        maxFilesize: 100,
        acceptedFiles: "image/*",
        addRemoveLinks: false,
        dictDefaultMessage: "Drag & drop files here or click to upload",
        clickable: true,
        init: function() {
            const dzInstance = this;
            this.on("addedfile", function(file) {
                const previewElement = file.previewElement;
                const deleteIcon = document.createElement("img");
                deleteIcon.src = "/assets/images/imgdelete.png";
                deleteIcon.alt = "Delete";
                deleteIcon.classList.add("delete-icon");
                previewElement.querySelector(".dz-image").appendChild(deleteIcon);

                deleteIcon.addEventListener("click", function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    dzInstance.removeFile(file);
                });
            });

            this.on("removedfile", function(file) {
                console.log("File removed:", file.name);
            });
        }
    });

    // Email validation
    document.getElementById("userEmail").addEventListener("input", function() {
        const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.value);
        document.getElementById("emailError").classList.toggle("d-none", isValid);
    });

    // Form submission
    document.getElementById("feedbackForm").addEventListener("submit", async function(event) {
        event.preventDefault();

        const formData = new FormData();
        formData.append("name", window.currentPlaceName);
        formData.append("id", window.currentPlaceId);
        formData.append("strPlacemarkId", window.currentStrPlacemarkId);    
        formData.append("feedbackText", document.getElementById("feedbackText").value);
        formData.append("userName", document.getElementById("userName").value);
        formData.append("userEmail", document.getElementById("userEmail").value);

        feedbackDropzone.files.forEach(file => {
            formData.append("images", file);
        });

        try {
            const response = await fetch(`/api/send-feedback`, {
                method: "POST",
                body: formData
            });
            const result = await response.json();

            // Cleanup after submission
            if (currentFeedbackForm) {
                currentFeedbackForm.remove();
                currentFeedbackForm = null;
            }
            if (feedbackDropzone) {
                feedbackDropzone.destroy();
                feedbackDropzone = null;
            }

            // Find the message div and footer within the correct context
            const messageDiv = contextElement ? contextElement.querySelector("#feedback-message") : document.getElementById("feedback-message");
            const modalFooter = contextElement ? contextElement.querySelector(".modal-footer") : document.querySelector(".modal-footer");

            if (messageDiv) {
                if (result.success) {
                    messageDiv.textContent = result.message || "Feedback submitted successfully!";
                    messageDiv.classList.remove("text-danger");
                    messageDiv.classList.add("text-success");
                } else {
                    messageDiv.textContent = result.error || "An error occurred.";
                    messageDiv.classList.remove("text-success");
                    messageDiv.classList.add("text-danger");
                }
            } else {
                console.error("Feedback message div not found in context.");
            }
            
            if (modalFooter) {
                modalFooter.style.display = "flex"; // Restore footer visibility
            } else {
                console.error("Modal footer not found in context.");
            }

        } catch (error) {
            console.error("Submission error:", error);
            // Attempt to restore footer even on error
            const modalFooter = contextElement ? contextElement.querySelector(".modal-footer") : document.querySelector(".modal-footer");
            if (modalFooter) modalFooter.style.display = "flex";
        }
    });
}

function cancelFeedback() {
    // Cleanup feedback form and Dropzone
    if (currentFeedbackForm) {
        currentFeedbackForm.remove();
        currentFeedbackForm = null;
    }
    if (feedbackDropzone) {
        feedbackDropzone.destroy();
        feedbackDropzone = null;
    }
    // Find the correct context and footer to restore
    const fullScreenInfo = document.getElementById('fullScreenInfo');
    const isFullScreen = fullScreenInfo && fullScreenInfo.classList.contains('visible');
    const contextElement = isFullScreen ? fullScreenInfo.querySelector('#fullscreen-content-area') : document.querySelector(".leaflet-popup-content");
    if (contextElement) {
        let modalFooter = contextElement.querySelector(".modal-footer");
        if (modalFooter) modalFooter.style.display = "flex";
    } else {
        // Fallback for safety, though contextElement should exist if form was shown
        let fallbackFooter = document.querySelector(".modal-footer");
        if (fallbackFooter) fallbackFooter.style.display = "flex";
    }
}

// Export functions
export {
    changeSwiper,
    initSwiper,
    getAngleRange,
    loadPlaceDetails,
    showFeebackForm,
    cancelFeedback
};