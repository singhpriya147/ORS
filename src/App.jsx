import { useState, useEffect, useRef } from "react";
// BLUETOOTH CONNECTION
let bleCharacteristic = null;

async function connectBluetooth() {
  const device = await navigator.bluetooth.requestDevice({
    // filters: [{ services: ["12345678-1234-1234-1234-123456789abc"] }],
    filters: [{ name: "ESP32_BLE" }],
    optionalServices: ["12345678-1234-1234-1234-123456789abc"],
  });

  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(
    "12345678-1234-1234-1234-123456789abc",
  );

  bleCharacteristic = await service.getCharacteristic(
    "abcd1234-5678-1234-5678-123456789abc",
  );

  console.log("Bluetooth connected");
}

const THRESHOLD_VALUE = 5;
const TURN_TYPE_MAP = {
  0: "left",
  1: "right",
  2: "sharp_left",
  3: "sharp_right",
  4: "slight_left",
  5: "slight_right",
  6: "straight",
  7: "enter_roundabout",
  8: "exit_roundabout",
  9: "u_turn",
  10: "goal",
  11: "depart",
  12: "keep_left",
  13: "keep_right",
};
const App = () => {
  const [source, setSource] = useState("80.247098,12.959819");
  const [destination, setDestination] = useState("80.239593,12.934079");
  const [data, setData] = useState(null);
  const [steps, setSteps] = useState([]);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [remainingDist, setRemainingDist] = useState(0);
  const [userLocation, setUserLocation] = useState(null);

  function fetchData(srcData, desData) {
    const api_key = import.meta.env.VITE_ORS_API_KEY;
    fetch(
      `https://api.openrouteservice.org/v2/directions/driving-car` +
        `?api_key=${api_key}` +
        `&start=${srcData}` +
        `&end=${desData}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          Accept:
            "application/json, application/geo+json, application/gpx+xml, img/png; charset=utf-8",
        },
      },
    )
      .then((res) => {
        if (!res.ok) throw new Error("Request failed");
        return res.json();
      })
      .then((data) => {
        console.log(data);
        setData(data);
        // turn-by-turn steps:
        console.log(
          "steps data",
          data.features[0].properties.segments[0].steps,
        );
        // setSteps(data.features[0].properties.segments[0].steps);
        setSteps(data.features[0].properties.segments[0].steps);
      })
      .catch((err) => console.error(err));
  }
  function distance(userLocation, stepEnd) {
    const [lng1, lat1] = userLocation;
    const [lng2, lat2] = stepEnd;

    const R = 6371000;
    const toRad = (deg) => (deg * Math.PI) / 180;

    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);

    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  // function getLocation() {
  //   if (navigator.geolocation) {
  //     navigator.geolocation.getCurrentPosition((position) => {
  //       setUserLocation([position.coords.longitude, position.coords.latitude]);
  //     });
  //     console.log("navigator.geolocation", navigator.geolocation);
  //   } else {
  //     alert("Geolocation is not supported by this browser.");
  //   }
  // }
  useEffect(() => {
    if (!data) return;

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        setUserLocation([position.coords.longitude, position.coords.latitude]);
      },
      (error) => console.error(error),
      {
        enableHighAccuracy: true,
        maximumAge: 1000,
        timeout: 5000,
      },
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [data]);
  const handleSubmit = (e) => {
    e.preventDefault();

    console.log("value of source", source);

    console.log("value of destination ", destination);

    fetchData(source, destination);
  };

  useEffect(() => {
    if (!data || steps.length === 0) return;

    const geometry = data.features[0].geometry.coordinates;
    const step = steps[currentStepIndex];
    if (!step) return;

    const stepEndCoord = geometry[step.way_points[1]];

    if (!userLocation || userLocation.length !== 2) return;

    const metersLeft = distance(userLocation, stepEndCoord);
    console.log("metersLeft", metersLeft);

    // setRemainingDist((prev) =>
    //   prev === 0 ? metersLeft : Math.min(prev, metersLeft),
    // );
    setRemainingDist(metersLeft);
    if (metersLeft < THRESHOLD_VALUE) {
      setCurrentStepIndex((prev) => prev + 1);
    }
  }, [userLocation, currentStepIndex, data, steps]);

  const LAST_SENT_STEP = useRef(null);
  const LAST_SENT_DIST = useRef(null);

  useEffect(() => {
    if (!bleCharacteristic) return;

    const step = steps[currentStepIndex];
    if (!step) return;

    const dist = Math.round(remainingDist);
    const turn = TURN_TYPE_MAP[step.type];

    if (
      LAST_SENT_STEP.current === currentStepIndex &&
      Math.abs(LAST_SENT_DIST.current - dist) < 5
    ) {
      return; // don't spam
    }

    LAST_SENT_STEP.current = currentStepIndex;
    LAST_SENT_DIST.current = dist;

    const msg = `TURN:${turn};DIST:${dist}`;
    bleCharacteristic.writeValue(new TextEncoder().encode(msg));
  }, [currentStepIndex, remainingDist]);
  useEffect(() => {
    const step = steps[currentStepIndex];
    if (!step) return;

    console.log(
      "STEP",
      currentStepIndex,
      "TURN",
      TURN_TYPE_MAP[step.type],
      "DIST",
      Math.round(remainingDist),
    );
  }, [currentStepIndex, remainingDist]);

  // useEffect(() => {
  //   if (!bleCharacteristic) return;
  //   if (!steps[currentStepIndex]) return;
  //   if (remainingDist <= 0) return;

  //   const turnType = TURN_TYPE_MAP[steps[currentStepIndex].type];
  //   const dist = Math.round(remainingDist);

  //   const message = `TURN:${turnType};DIST:${dist}`;

  //   const data = new TextEncoder().encode(message);
  //   bleCharacteristic.writeValue(data);

  //   console.log("Sent to device:", message);
  // }, [currentStepIndex, remainingDist]);
  useEffect(() => {
    if (!data) return;
    const geometry = data.features[0].geometry.coordinates;
    const mockPath = geometry;
    let i = 0;
    const interval = setInterval(() => {
      setUserLocation(mockPath[i]);
      i++;
      if (i >= mockPath.length) clearInterval(interval);
    }, 1500);

    return () => clearInterval(interval);
  }, [data]);

  return (
    <div>
      <form action="" onSubmit={(e) => handleSubmit(e)}>
        <input
          type="text"
          value={source}
          onChange={(e) => {
            setSource(e.target.value);
          }}
        />
        <input
          type="text"
          value={destination}
          onChange={(e) => {
            setDestination(e.target.value);
          }}
        />
        <button type="submit">Search</button>
      </form>
      <div>
        <span>{currentStepIndex}</span>
        {/* <h2>{steps[currentStepIndex]?.type}</h2> */}
        {/* this line should tell the distance of upcoming turn*/}
        <p>{Math.round(steps[currentStepIndex]?.distance)} meters</p>.
        <p>{steps[currentStepIndex]?.instruction}</p>
        <p>{remainingDist}</p>
        <h2>{TURN_TYPE_MAP[steps[currentStepIndex]?.type]}</h2>
      </div>
      {/* <div>
        <button onClick={() => handleSteps()}>Increase Step</button>
      </div> */}
      <button onClick={connectBluetooth}>Connect Device</button>
    </div>
  );
};
export default App;
// OFFICE --80.247098,12.959819
// house --80.239593,12.934079

// bluettoth api

// send this data over bluetooth .
