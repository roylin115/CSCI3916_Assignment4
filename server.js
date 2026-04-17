/*
CSC3916 HW4
File: Server.js
Description: Web API scaffolding for Movie API
 */

require('dotenv').config();

var mongoose = require('mongoose');
var express = require('express');
var bodyParser = require('body-parser');
var passport = require('passport');
var authController = require('./auth');
var authJwtController = require('./auth_jwt');
var jwt = require('jsonwebtoken');
var cors = require('cors');
var User = require('./Users');
var Movie = require('./Movies');
var Review = require('./Reviews');
const crypto = require("crypto");
var rp = require('request-promise');

var app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cors());
app.use(passport.initialize());

var router = express.Router();

const GA_TRACKING_ID = process.env.GA_KEY;

function trackDimension(category, action, label, value, dimension, metric) {
    var options = { method: 'GET',
        url: 'https://www.google-analytics.com/collect',
        qs:
            {   // API Version.
                v: '1',
                // Tracking ID / Property ID.
                tid: GA_TRACKING_ID,
                // Random Client Identifier. Ideally, this should be a UUID that
                // is associated with particular user, device, or browser instance.
                cid: crypto.randomBytes(16).toString("hex"),
                // Event hit type.
                t: 'event',
                // Event category.
                ec: category,
                // Event action.
                ea: action,
                // Event label.
                el: label,
                // Event value.
                ev: value,
                // Custom Dimension
                cd1: dimension,
                // Custom Metric
                cm1: metric
            },
        headers:
            {  'Cache-Control': 'no-cache' } };

    return rp(options);
}

function getJSONObjectForMovieRequirement(req) {
    var json = {
        headers: "No headers",
        key: process.env.UNIQUE_KEY,
        body: "No body"
    };

    if (req.body != null) {
        json.body = req.body;
    }

    if (req.headers != null) {
        json.headers = req.headers;
    }

    return json;
}

router.post('/signup', function(req, res) {
  console.log("BODY:", req.body);
    if (!req.body.username || !req.body.password) {
        return res.json({success: false, msg: 'Please include both username and password to signup.'});
    } else {
        var user = new User();
        user.name = req.body.name;
        user.username = req.body.username;
        user.password = req.body.password;

        user.save(function(err){
            if (err) {
                console.log("Error saving user:", err);

                if (err.code == 11000)
                    return res.json({ success: false, message: 'A user with that username already exists.'});
                else
                    return res.json(err);
            }

            return res.json({success: true, msg: 'Successfully created new user.'})
        });
    }
});

router.post('/signin', function (req, res) {
    var userNew = new User();
    userNew.username = req.body.username;
    userNew.password = req.body.password;

    User.findOne({ username: userNew.username }).select('name username password').exec(function(err, user) {
        if (err) {
            res.send(err);
        }

        if (!user) {
            return res.status(401).json({
                success: false,
                msg: 'Authentication failed. User not found.'
            });
        }

        user.comparePassword(userNew.password, function(isMatch) {
            if (isMatch) {
                var userToken = { id: user.id, username: user.username };
                var token = jwt.sign(userToken, process.env.SECRET_KEY);
                res.json ({success: true, token: 'JWT ' + token});
            }
            else {
                res.status(401).send({success: false, msg: 'Authentication failed.'});
            }
        })
    })
});

router.route('/movies')
    .get(authJwtController.isAuthenticated, async (req, res) => {
      try {
        if(req.query.reviews === 'true') {
          const movies = await Movie.aggregate([
            {
              $lookup: {
                from: 'reviews',
                localField: '_id',
                foreignField: 'movieId',
                as: 'movieReviews'
              }
            },
            {
              $addFields: {
                avgRating: { $avg: '$movieReviews.rating' }
              }
            },
            {
              $sort: { avgRating: -1 }
            }
          ]);

          return res.json(movies);
        }
        const movies = await Movie.aggregate([
          {
            $lookup: {
              from: 'reviews',
              localField: '_id',
              foreignField: 'movieId',
              as: 'movieReviews'
            }
          },
          {
            $addFields: {
              avgRating: { $avg: '$movieReviews.rating' }
            }
          },
          {
            $sort: { avgRating: -1 }
          }
        ]);
        res.json(movies);
      } catch (err) {
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again later.' }); // 500 Internal Server Error
      }
    })
    .post(authJwtController.isAuthenticated, async (req, res) => {
      try {
        if(!req.body.actors || req.body.actors.length === 0) {
          return res.status(400).json({ success: false, message: 'Please include at least one actor for the movie.' });
        }
        const movie = new Movie(req.body);
        await movie.save();

        res.status(201).json(movie);
      } catch (err) {
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again later.' });
      }
    })
    ;

router.route('/movies/:id')
  .get(authJwtController.isAuthenticated, async (req, res) => {
    try {
        const movieId = req.params.id;



        //If reviews is true then use aggregation to get movie with reviews, otherwise just get movie
        if(req.query.reviews === 'true') {
            const result = await Movie.aggregate([
                {
                    $match: { _id: new mongoose.Types.ObjectId(movieId) }
                },
                {
                    $lookup: {
                        from: 'reviews',
                        localField: '_id',
                        foreignField: 'movieId',
                        as: 'movieReviews'
                    }
                },
                {
                    $addFields: {
                        avgRating: { $avg: '$movieReviews.rating' }
                    }
                }
            ]);

            if(!result || result.length === 0) {
                return res.status(404).json({message: 'Movie not found.' });
            }
            return res.json(result[0]);
        }

        const movie = await Movie.findById(movieId);
        if(!movie) {
            return res.status(404).json({message: 'Movie not found.' });
        }

        res.json(movie);

        } catch (err) {
      res.status(500).json({ success: false, message: 'Something went wrong.' });
    }
  })
  .put(authJwtController.isAuthenticated, async (req, res) => {
    try {
      const movie = await Movie.findByIdAndUpdate(
        req.params.id,
        req.body,
        { new: true, runValidators: true }
      );

      if (!movie) {
        return res.status(404).json({ success: false, message: 'Movie not found.' });
      }

      res.json(movie);
    } catch (err) {
      res.status(500).json({ success: false, message: 'Something went wrong.' });
    }
  })
  .delete(authJwtController.isAuthenticated, async (req, res) => {
    try {
      const movie = await Movie.findByIdAndDelete(req.params.id);

      if (!movie) {
        return res.status(404).json({ success: false, message: 'Movie not found.' });
      }

      res.json({ success: true, msg: 'Successfully deleted movie.' });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Something went wrong.' });
    }
  });


router.get('/reviews', authJwtController.isAuthenticated, async (req, res) => {
  try {
    const query = req.query.movieId ? { movieId: req.query.movieId } : {};
    const reviews = await Review.find(query);
    res.json(reviews);
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error retrieving reviews' });
  }
});


router.post('/reviews', authJwtController.isAuthenticated, async (req, res) => {
  try {
    const { movieId, review, rating } = req.body;
    const username = req.user.username;

    // Validate input
    if (!movieId || !username || !review || rating == null) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    // 🔥 REQUIRED FOR GRADING: check movie exists
    const movie = await Movie.findById(movieId);
    if (!movie) {
      return res.status(404).json({ message: 'Movie not found' });
    }

    const newReview = new Review({
      movieId,
      username,
      review,
      rating
    });

    await newReview.save();
    try {
        await trackDimension(
        movie.genre || 'Unknown',          // Event Category
        'POST /reviews',                  // Event Action
        'API Request for Movie Review',   // Event Label
        1,                                // Event Value
        movie.title,                      // Custom Dimension (movie name)
        1                                 // Custom Metric
        );
    }
    catch (err) {
        console.error('Analytics error:', err.message);
    }

    res.json({ message: 'Review created!' });

  } catch (err) {
    res.status(500).json({ message: 'Error saving review' });
  }
});

router.post('/search', authJwtController.isAuthenticated, async (req, res) => {
  try {
    const {query} = req.body;

    if (!query) {
      return res.status(400).json({ message: 'Missing search query' });
    }

    const movies = await Movie.find({
      $or: [
        { title: { $regex: query, $options: 'i' } },
        { "actors.actorName": { $regex: query, $options: 'i' } }
      ]
    });

    res.json(movies);
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error searching movies' });
  }
  
});

app.use('/', router);
app.listen(process.env.PORT || 8080);
module.exports = app; // for testing only


