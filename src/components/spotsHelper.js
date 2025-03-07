// spotsHelper.js - Common functionality for loading and displaying spots on a map

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

        let description = (data.properties.description || "")
            .replace(regex1, "")
            .replace(regex2, "")
            .trim();

        window.currentPlaceName = data.properties.name;

        let popupContent = `<span style="color: #0087F7;"><h5>${data.properties.name}</h5></span>
                            <b>Type:</b> ${data.properties.type}<br>
                            <b>Direction:</b> ${data.properties.direction}<br><br>
                            <b>Description:</b> ${description}
                            <div class="modal-footer d-flex justify-content-between">
                            <div id="feedback-message" class="text-start"></div> <!-- Message on the left -->
                            <div class="d-flex ms-auto">
                                <button class="btn btn-primary me-2" onclick="showFeebackForm()">Feedback/Correction</button>
                                <button class="btn btn-dark close-popup">Close</button>
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

        layer.setPopupContent(popupContent);

        // Wait for the popup to open before initializing Swiper
        setTimeout(() => {
            let firstImg = document.querySelector(".swiper1 .swiper-slide img");
            if (firstImg) {
                let idImg = parseInt(firstImg.id.replace(/\D/g, ""), 10) || 1;
                initSwiper(idImg); // Call existing Swiper function
            }
    
        }, 300);

        setTimeout(() => {
            document.querySelector(".close-popup").addEventListener("click", function () {
                map.closePopup();
            });
        }, 300);

    } catch (error) {
        console.error("Error fetching place details:", error);
    }
}

function showFeebackForm() {
    let modalFooter = document.querySelector(".modal-footer");
    if (modalFooter) modalFooter.style.display = "none";

    let feedbackFormHtml = `
        <div id="feedbackFormHtml">
        <div class="feedback-modal">
            <span style="color: #0087F7;"><h5>Feedback for ${window.currentPlaceName}</h5></span>
            <form id="feedbackForm">
                <div class="form-group">
                    <label for="feedbackText">Feedback / Correction / Comment:</label>
                    <textarea id="feedbackText" class="form-control" required style="height: 130px;"></textarea>
                </div>
                <!-- Dropzone for file upload -->
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
                <button type="submit" class="btn btn-success">Submit</button>
                <button type="button" class="btn btn-secondary" onclick="cancelFeedback()">Cancel</button>
            </form>
        </div>
        </div>
    `;

    let popup = document.querySelector(".leaflet-popup-content");
    if (popup) {
        popup.insertAdjacentHTML("beforeend", feedbackFormHtml);
    } else {
        console.error("Popup content not found!");
        return;
    }

    let uploadedFiles = []; // Store files in an array

    let dropzone = new Dropzone("#dropzoneFeedback", {
        url: "/upload", // This won't be used since we disable auto uploads
        autoProcessQueue: false, // Prevent immediate upload
        maxFiles: 5,
        maxFilesize: 100, // Max file size in MB
        acceptedFiles: "image/*", // Only accept image files
        addRemoveLinks: false, // Disable default remove link
        dictDefaultMessage: "Drag & drop files here or click to upload",
        clickable: true,
        init: function () {
            let dzInstance = this; // Store Dropzone instance

            this.on("addedfile", function (file) {
                console.log("File added:", file.name);
            
                let previewElement = file.previewElement;
                let imageContainer = previewElement.querySelector(".dz-image"); // Ensure it's inside the image div
            
                if (!imageContainer) {
                    console.error("dz-image container not found for:", file.name);
                    return;
                }
            
                let deleteIcon = document.createElement("img");
                deleteIcon.src = "/assets/images/imgdelete.png"; // Ensure the path is correct
                deleteIcon.alt = "Delete";
                deleteIcon.classList.add("delete-icon");
            
                // Append delete icon to the image container
                imageContainer.appendChild(deleteIcon);
            
                console.log("Delete icon added for:", file.name);
            
                deleteIcon.addEventListener("click", function (e) {
                    e.preventDefault();
                    e.stopPropagation(); // Prevent triggering Dropzone click events
                    console.log("Delete icon clicked for:", file.name);
            
                    dzInstance.removeFile(file);
                });
            });
            

            this.on("removedfile", function (file) {
                console.log("File removed:", file.name); // Log file removed
                uploadedFiles = uploadedFiles.filter(f => f !== file);
            });
        }
    });


    document.getElementById("userEmail").addEventListener("input", function () {
        let isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.value);
        document.getElementById("emailError").classList.toggle("d-none", isValid);
    });

    document.getElementById("feedbackForm").addEventListener("submit", async function (event) {
        event.preventDefault();
    
        let formData = new FormData();
        formData.append("feedbackText", document.getElementById("feedbackText").value);
        formData.append("userName", document.getElementById("userName").value);
        formData.append("userEmail", document.getElementById("userEmail").value);
        
        let dropzoneFiles = Dropzone.forElement("#dropzoneFeedback").files;
        dropzoneFiles.forEach(file => {
            formData.append("images", file);
        });

        let response = await fetch("/api/send-feedback", {
            method: "POST",
            body: formData
        });
    
        let result = await response.json();
    
        // Hide the entire feedback form container
        document.getElementById("feedbackFormHtml").style.display = "none";

        // Show the modal footer
        document.querySelector(".modal-footer").style.display = "flex";

        // Get the message div
        let messageDiv = document.getElementById("feedback-message");

        // Set message text properly
        if (result.success && typeof result.success === "string") {
            messageDiv.textContent = result.success;
            messageDiv.classList.remove("text-danger");
            messageDiv.classList.add("text-success");
        } else if (result.success === true) {
            messageDiv.textContent = "Feedback submitted successfully!";
            messageDiv.classList.remove("text-danger");
            messageDiv.classList.add("text-success");
        } else {
            messageDiv.textContent = result.error || "An error occurred.";
            messageDiv.classList.remove("text-success");
            messageDiv.classList.add("text-danger");
        }
    });
}

function cancelFeedback() {
    // Hide the feedback form
    document.getElementById("feedbackFormHtml").style.display = "none";
    // Show the modal footer again
    document.querySelector(".modal-footer").style.display = "flex";
}

// Export functions to be used by other modules
export {
    changeSwiper,
    initSwiper,
    getAngleRange,
    loadPlaceDetails,
    showFeebackForm,
    cancelFeedback
};