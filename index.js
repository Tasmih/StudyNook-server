const dns = require("node:dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

dotenv.config();

const uri = process.env.MONGODB_URI;

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();

    const db = client.db("studynook");

    
    const roomCollection = db.collection("rooms");
    const bookingsCollections = db.collection("bookings");

    
    // GET ALL ROOMS
    
    app.get("/room", async (req, res) => {
      const result = await roomCollection.find().toArray();
      res.json(result);
    });


    // CREATE ROOM
    app.post("/room", async (req, res) => {
      const roomData = req.body;
      const result = await roomCollection.insertOne(roomData);
      res.json(result);
    });

    // FEATURED ROOMS

    app.get("/featured", async (req, res) => {
      const result = await roomCollection
        .find()
        .sort({ _id: -1 })
        .limit(6)
        .toArray();

      res.json(result);
    });


    // SINGLE ROOM DETAILS
    
    app.get("/room/:id", async (req, res) => {
      const { id } = req.params;

      const result = await roomCollection.findOne({
        _id: new ObjectId(id),
      });

      res.json(result);
    });

    
    // UPDATE ROOM
  
    app.patch("/room/:id", async (req, res) => {
      const { id } = req.params;
      const updatedData = req.body;

      const result = await roomCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updatedData }
      );

      res.json(result);
    });

  
    // DELETE ROOM
    
    app.delete("/room/:id", async (req, res) => {
      const { id } = req.params;

      const result = await roomCollection.deleteOne({
        _id: new ObjectId(id),
      });

      res.json(result);
    });

    
    // BOOK ROOM 
  
    app.post("/bookings", async (req, res) => {
      try {
        const booking = req.body;

        const {
          roomId,
          roomName,
          roomImage,
          userId,
          userName,
          userEmail,
          bookingDate,
          startTime,
          endTime,
          totalCost,
          specialNote,
        } = booking;

        //  VALIDATION: required fields check
        if (!roomId || !userId || !bookingDate || !startTime || !endTime) {
          return res.status(400).send({
            message: "Room, user, date, start time and end time are required",
          });
        }

        //  FIX 2: use correct collection name
        const room = await roomCollection.findOne({
          _id: new ObjectId(roomId),
        });

        if (!room) {
          return res.status(404).send({
            message: "Room not found",
          });
        }

        //  DATE VALIDATION
        const today = new Date().toISOString().split("T")[0];

        if (bookingDate < today) {
          return res.status(400).send({
            message: "Booking date must be today or future date",
          });
        }

        //  TIME VALIDATION
        const startHour = Number(startTime.split(":")[0]);
        const endHour = Number(endTime.split(":")[0]);

        if (endHour <= startHour) {
          return res.status(400).send({
            message: "End time must be after start time",
          });
        }

        //  CONFLICT CHECK (IMPORTANT LOGIC)
        const conflict = await bookingsCollections.findOne({
          roomId,
          bookingDate,
          status: "confirmed",
          startTime: { $lt: endTime },
          endTime: { $gt: startTime },
        });

        if (conflict) {
          return res.status(409).send({
            message: "This room is already booked for selected time slot",
          });
        }

        //  COST CALCULATION
        const calculatedCost =
          (endHour - startHour) * Number(room.hourlyRate);

        //  FINAL BOOKING DATA
        const newBooking = {
          roomId,
          roomName: roomName || room.roomName,
          roomImage: roomImage || room.image,
          userId,
          userName,
          userEmail,
          bookingDate,
          startTime,
          endTime,
          totalCost: calculatedCost, // FIXED (no fallback bug)
          specialNote: specialNote || "",
          status: "confirmed",
          createdAt: new Date().toISOString(),
        };

        //  INSERT BOOKING
        const result = await bookingsCollections.insertOne(newBooking);

        //  UPDATE ROOM BOOKING COUNT
        await roomCollection.updateOne(
          { _id: new ObjectId(roomId) },
          { $inc: { bookingCount: 1 } }
        );

        res.send(result);
      } catch (error) {
        console.log(error);

        res.status(500).send({
          message: "Failed to book room",
        });
      }
    });

   app.get("/bookings/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const bookings = await bookingsCollections
      .find({ userId })
      .sort({ createdAt: -1 })
      .toArray();

    res.json(bookings);
  } catch (error) {
    res.status(500).send({ message: "Failed to fetch bookings" });
  }
});

app.patch("/bookings/:id/cancel", async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.body;

    const booking = await bookingsCollections.findOne({
      _id: new ObjectId(id),
    });

    if (!booking) {
      return res.status(404).send({ message: "Booking not found" });
    }

    if (booking.userId !== userId) {
      return res.status(403).send({ message: "Unauthorized" });
    }

    await bookingsCollections.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: "cancelled" } }
    );

    await roomCollection.updateOne(
      { _id: new ObjectId(booking.roomId) },
//       { $inc: { bookingCount: -1 } }
//     );

//     res.send({ message: "Booking cancelled successfully" });
//   } catch (error) {
//     res.status(500).send({ message: "Failed to cancel booking" });
//   }
// });

    await client.db("admin").command({ ping: 1 });
    console.log("MongoDB connected successfully!");
  } finally {
    // keep connection alive
  }
}

run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Server is running fine!");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});