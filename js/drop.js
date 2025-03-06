Dropzone.options.myDropzone = {
    url: "/upload",
    autoProcessQueue: true,
    paramName: "image",
    maxFilesize: 5, // in MB
    addRemoveLinks: true,
    clickable: true,
    acceptedFiles: "image/jpeg,image/png,image/gif",
    dictDefaultMessage: "Upload your file here",
    init: function () {
        this.on("sending", function (file, xhr, formData) {
            console.log("sending file");
        });
        this.on("success", function (file, responseText) {
            console.log('great success');
        });
        this.on("addedfile", function (file) {
            console.log('file added');
        });
    }
};
