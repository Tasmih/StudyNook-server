const dns = require("node:dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const { createRemoteJWKSet, jwtVerify } = require("jose-cjs");

dotenv.config();

const uri = process.env.MONGODB_URI;

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// mongodb client setup
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// jwks setup
const JWKS = createRemoteJWKSet(
  new URL("http://localhost:3000/api/auth/jwks")
);

// token verify middleware
const verifyToken = async (req, res, next) => {
  const authHeader = req?.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ message: "unauthorized" });
  }

  const token = authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "unauthorized" });
  }

  try {
    const { payload } = await jwtVerify(token, JWKS);
    console.log("jwt payload:", payload);

    req.user = {
      id: payload.sub,
      email: payload.email,
    };

    
  } catch (error) {
    console.log("jwt error:", error.message);
    return res.status(403).json({ message: "forbidden" });
  }
};
async function run() {
  try {
    await client.connect();

    const db = client.db("studynook");

    const roomCollection = db.collection("rooms");
    const bookingsCollection = db.collection("bookings");

    // get all rooms with search + filter
    app.get("/room", async (req, res) => {
      try {
        const { search, amenities, min, max } = req.query;

        const query = {};

        // search by room name or description
        if (search) {
          query.$or = [
            { roomName: { $regex: search, $options: "i" } },
            { description: { $regex: search, $options: "i" } },
          ];
        }

        // amenities filter
        if (amenities) {
          query.amenities = {
            $in: amenities.split(",").map((a) => a.trim()),
          };
        }

        // price filter
        if (min || max) {
          query.hourlyRate = {};
          if (min) query.hourlyRate.$gte = Number(min);
          if (max) query.hourlyRate.$lte = Number(max);
        }

        const rooms = await roomCollection.find(query).toArray();

        res.json(rooms);
      } catch (error) {
        res.status(500).json({ message: "failed to fetch rooms" });
      }
    });

    // create room (protected)
    app.post("/room", verifyToken, async (req, res) => {
      const roomData = req.body;

      const result = await roomCollection.insertOne(roomData);
      res.json(result);
    });

    // featured rooms
    app.get("/featured", async (req, res) => {
      const result = await roomCollection
        .find()
        .sort({ _id: -1 })
        .limit(6)
        .toArray();

      res.json(result);
    });

    // single room details (protected)
    app.get("/room/:id", verifyToken, async (req, res) => {
      const { id } = req.params;

      const result = await roomCollection.findOne({
        _id: new ObjectId(id),
      });

      res.json(result);
    });

    // update room (owner only)
    app.patch("/room/:id", verifyToken, async (req, res) => {
      const { id } = req.params;
      const updatedData = req.body;

      const result = await roomCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updatedData }
      );

      res.json(result);
    });

    // delete room (owner only)
    app.delete("/room/:id", verifyToken, async (req, res) => {
      const { id } = req.params;

      const result = await roomCollection.deleteOne({
        _id: new ObjectId(id),
      });

      res.json(result);
    });

    // book room (protected)
    app.post("/bookings", verifyToken, async (req, res) => {
  try {
    const booking = req.body;

    const {
      roomId,
      roomName,
      roomImage,
      bookingDate,
      startTime,
      endTime,
    } = booking;

    // required field check
    if (!roomId || !bookingDate || !startTime || !endTime) {
      return res.status(400).send({
        message: "required fields missing",
      });
    }

    // find room
    const room = await roomCollection.findOne({
      _id: new ObjectId(roomId),
    });

    if (!room) {
      return res.status(404).send({ message: "room not found" });
    }

    // date validation
    const today = new Date().toISOString().split("T")[0];

    if (bookingDate < today) {
      return res.status(400).send({
        message: "invalid booking date",
      });
    }

    // time convert
    const startHour = Number(startTime.split(":")[0]);
    const endHour = Number(endTime.split(":")[0]);

    if (endHour <= startHour) {
      return res.status(400).send({
        message: "invalid time range",
      });
    }

   
    const conflict = await bookingsCollection.findOne({
      roomId,
      bookingDate,
      status: "confirmed",
      $or: [
        {
          startTime: { $lte: startTime },
          endTime: { $gte: startTime },
        },
        {
          startTime: { $lte: endTime },
          endTime: { $gte: endTime },
        },
      ],
    });

    if (conflict) {
      return res.status(409).send({
        message: "slot already booked",
      });
    }

    // total cost
    const totalCost = (endHour - startHour) * room.hourlyRate;

    // create booking object
    const newBooking = {
      roomId,
      roomName,
      roomImage,
      userId: req.user.id,
      userEmail: req.user.email,
      bookingDate,
      startTime,
      endTime,
      totalCost,
      status: "confirmed",
      createdAt: new Date().toISOString(),
    };

    // insert booking
    const result = await bookingsCollection.insertOne(newBooking);

    // increase booking count
    await roomCollection.updateOne(
      { _id: new ObjectId(roomId) },
      { $inc: { bookingCount: 1 } }
    );

    res.send(result);
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "booking failed" });
  }
});

    // get my bookings
   app.get("/bookings", verifyToken, async (req, res) => {
  try {
    console.log("req.user:", req.user);
    const userEmail = req.user.email;
    console.log("userEmail:", userEmail);

    const bookings = await bookingsCollection
      .find({ userEmail })
      .sort({ createdAt: -1 })
      .toArray();

    res.json(bookings);
  } catch (error) {
    res.status(500).send({ message: "failed to get bookings" });
  }
});

    // cancel booking
    app.patch("/bookings/:id/cancel", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "invalid id" });
        }

        const booking = await bookingsCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!booking) {
          return res.status(404).send({ message: "not found" });
        }

        if (booking.userEmail !== req.user.email) {
          return res.status(403).send({ message: "unauthorized" });
        }

        if (booking.status === "cancelled") {
          return res.status(400).send({ message: "already cancelled" });
        }

        await bookingsCollection.updateOne(
          { _id: booking._id },
          { $set: { status: "cancelled" } }
        );

        await roomCollection.updateOne(
          { _id: new ObjectId(booking.roomId) },
          { $inc: { bookingCount: -1 } }
        );

        res.json({ message: "booking cancelled" });
      } catch (error) {
        res.status(500).send({ message: "cancel failed" });
      }
    });

    await client.db("admin").command({ ping: 1 });
    console.log("mongodb connected successfully!");
  } finally {
    // keep connection alive
  }
}

run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("server is running fine!");
});

app.listen(PORT, () => {
  console.log(`server running on port ${PORT}`);
});