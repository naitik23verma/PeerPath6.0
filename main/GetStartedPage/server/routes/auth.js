import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import User from '../models/User.js';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, '../uploads/'));
  },
  filename: function (req, file, cb) {
    cb(null, 'profilePhoto-' + Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024 // Use env var or default to 5MB
  },
  fileFilter: function (req, file, cb) {
    const allowedTypes = /jpeg|jpg|png|gif/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'));
    }
  }
});

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ message: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// Register route
router.post('/register', upload.single('profilePhoto'), async (req, res) => {
  try {
    console.log('--- REGISTRATION ATTEMPT ---');
    console.log('Request body:', req.body);
    const { username, email, password, bio, year, expertise, skills, mobileNumber } = req.body;

    if (!email) {
      console.log('Email is missing');
      return res.status(400).json({ message: 'Email is required' });
    }

    console.log('Creating user with username:', username, 'email:', email);

    // Check if user already exists by username
    const existingUserByUsername = await User.findOne({ username });
    if (existingUserByUsername) {
      console.log('Username already exists:', username);
      return res.status(400).json({ message: 'Username already exists' });
    }

    // Check if user already exists by email
    const existingUserByEmail = await User.findOne({ email });
    if (existingUserByEmail) {
      console.log('Email already exists:', email);
      return res.status(400).json({ message: 'Email already registered. Please use a different email or try logging in.' });
    }

    // Create new user (password will be hashed by the model's pre-save middleware)
    const user = new User({
      username,
      email,
      password: password, // Don't hash here - the model will do it
      bio: bio || '',
      year: year || '',
      expertise: expertise || '',
      skills: skills || '',
      mobileNumber: mobileNumber || '',
      profilePhoto: req.file ? `/uploads/${req.file.filename}` : ''
    });

    await user.save();
    console.log('User saved successfully. Password hash:', user.password.substring(0, 20) + '...');

    // Create and sign JWT token
    const token = jwt.sign(
      { userId: user._id, username: user.username },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );

    console.log('Registration successful for:', username);

    // Return user data and token
    res.status(201).json({
      message: 'User registered successfully',
      user: {
        _id: user._id,
        username: user.username,
        email: user.email,
        mobileNumber: user.mobileNumber,
        bio: user.bio,
        year: user.year,
        expertise: user.expertise,
        skills: user.skills,
        profilePhoto: user.profilePhoto
      },
      token
    });
  } catch (error) {
    console.error('Registration error:', error);
    
    // Handle specific MongoDB duplicate key errors
    if (error.code === 11000) {
      if (error.keyPattern && error.keyPattern.email) {
        return res.status(400).json({ message: 'Email already registered. Please use a different email or try logging in.' });
      } else if (error.keyPattern && error.keyPattern.username) {
        return res.status(400).json({ message: 'Username already exists. Please choose a different username.' });
      }
    }
    
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Login route
router.post('/login', async (req, res) => {
  try {
    console.log('--- LOGIN ATTEMPT ---');
    console.log('Request body:', req.body);
    const { username, password } = req.body;
    console.log('Parsed username:', username);
    console.log('Parsed password:', password ? '***' : undefined);

    if (!username || !password) {
      console.log('Missing username or password');
      return res.status(400).json({ message: 'Username/email and password are required.' });
    }

    // Determine if username is an email
    const isEmail = username && username.includes('@');
    const user = await User.findOne(isEmail ? { email: username } : { username });
    console.log('User found:', user ? user.username : null, '| Email:', user ? user.email : null);
    if (!user) {
      console.log('No user found for', username);
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // Verify password
    let isMatch = false;
    try {
      isMatch = await bcrypt.compare(password, user.password);
      console.log('bcrypt.compare result:', isMatch);
    } catch (e) {
      console.log('bcrypt.compare error:', e);
      isMatch = false;
    }

    if (!isMatch) {
      console.log('Final result: Invalid credentials');
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // Create and sign JWT token
    const token = jwt.sign(
      { userId: user._id, username: user.username },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );

    // Return user data and token
    res.json({
      user: {
        _id: user._id,
        username: user.username,
        email: user.email,
        mobileNumber: user.mobileNumber,
        bio: user.bio,
        year: user.year,
        expertise: user.expertise,
        skills: user.skills,
        profilePhoto: user.profilePhoto
      },
      token
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get current user route
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Update user profile route
router.put('/profile', authenticateToken, upload.single('profilePhoto'), async (req, res) => {
  try {
    const { bio, year, expertise, skills, github, linkedin, twitter, mobileNumber } = req.body;
    const user = await User.findById(req.user.userId);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Update fields
    if (bio !== undefined) user.bio = bio;
    if (year !== undefined) user.year = year;
    if (expertise !== undefined) user.expertise = expertise ? expertise.split(',').map(skill => skill.trim()) : [];
    if (skills !== undefined) user.skills = skills ? skills.split(',').map(skill => skill.trim()) : [];
    if (github !== undefined) user.github = github;
    if (linkedin !== undefined) user.linkedin = linkedin;
    if (twitter !== undefined) user.twitter = twitter;
    if (mobileNumber !== undefined) user.mobileNumber = mobileNumber;
    if (req.file) user.profilePhoto = `/uploads/${req.file.filename}`;

    await user.save();

    // Return updated user data without password
    const userResponse = {
      _id: user._id,
      username: user.username,
      bio: user.bio,
      year: user.year,
      expertise: user.expertise,
      skills: user.skills,
      mobileNumber: user.mobileNumber,
      profilePhoto: user.profilePhoto,
      doubtsSolved: user.doubtsSolved,
      doubtsAsked: user.doubtsAsked,
      joinDate: user.joinDate,
      github: user.github,
      linkedin: user.linkedin,
      twitter: user.twitter
    };

    res.json({
      message: 'Profile updated successfully',
      user: userResponse
    });

  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

export { authenticateToken };
export default router; 