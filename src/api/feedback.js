import { Router } from 'express';
import multer from 'multer';
import nodemailer from 'nodemailer';
import fs from 'fs';

// Configure multer for file uploads
const upload = multer({ dest: "uploads/" });

// Create router
const router = Router();

// Create and export feedback route
export default function createFeedbackRouter() {
    // Create email transporter
    const transporter = nodemailer.createTransport({
        host: process.env.MAIL_HOST,
        port: 587,
        secure: false,
        auth: {
            user: process.env.MAIL_USER,
            pass: process.env.MAIL_PASSWORD 
        }
    });

    // Send feedback endpoint with file upload capability
    router.post("/send-feedback", upload.array("images", 5), async (req, res) => {
        try {
            const { feedbackText, userName, userEmail } = req.body;
            const attachments = req.files.map(file => ({
                filename: file.originalname,
                path: file.path
            }));

            let mailOptions = {
                from: process.env.MAIL_USER,
                to: process.env.MAIL_USER,
                subject: "User Feedback Submission",
                text: `Feedback: ${feedbackText}\nName: ${userName}\nEmail: ${userEmail}`,
                attachments: attachments
            };

            let info = await transporter.sendMail(mailOptions);
            console.log("Email sent: " + info.response);

            // Cleanup: Delete uploaded files after sending
            attachments.forEach(file => fs.unlinkSync(file.path));

            res.json({ success: true, message: "Feedback submitted successfully" });
        } catch (error) {
            console.error("Error sending email:", error);
            res.status(500).json({ success: false, error: "Failed to send feedback" });
        }
    });

    return router;
}