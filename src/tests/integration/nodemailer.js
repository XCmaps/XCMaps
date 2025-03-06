import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
    host: 'mail.hostedoffice.ag',
    port: 587,
    secure: false, 
    auth: {
        user: 'info@lorenzmeis.net',
        pass: '@Jy58si7812'
    }
});

// Configure the mailoptions object
const mailOptions = {
    from: 'info@lorenzmeis.net',
    to: 'info@lorenzmeis.net',
    subject: 'Sending Email using Node.js',
    text: 'That was easy!'
  };


transporter.sendMail(mailOptions, function(error, info){
  if (error) {
    console.log(error);
  } else {
    console.log('Email sent: ' + info.response);
  }
});