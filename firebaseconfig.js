// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDnppB7CXp0eZLNhvXeyKNDvO0R1YVsf2I",
  authDomain: "kirkclient.firebaseapp.com",
  projectId: "kirkclient",
  storageBucket: "kirkclient.firebasestorage.app",
  messagingSenderId: "324941983054",
  appId: "1:324941983054:web:2976a14fc5cc05d89d021f",
  measurementId: "G-E0ZPPKNBD8"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);