# listen to an arduino over serial port

import serial, json
import os
import subprocess
from subprocess import Popen

arduino = serial.Serial('/dev/ttyACM0', 57600) # serial port# and baud rate

def chunks(l, n):
  return [l[i:i+n] for i in range(0, len(l), n)]

def post_to_server(queen_id, ant_id, ping_id, colony_id):
  # subprocess.call(["curl", "-X", "POST", "-d", "colony=" + colony_id, "-d", "ant=" + ant_id, "-d", "ping=" + ping_id, "localhost:5000/binds"])
  Popen(["curl", "-X", "POST", "-d", "colony=" + colony_id, "-d", "ant=" + ant_id, "-d", "ping=" + ping_id, "api.olinexpo.com/binds"])

def append_to_file(filename, data):
  with open(filename, "a") as f: # open file in append mode
    f.write(data+"\n")

def grab_ant_ids():
  old_ant_list_size = len(ant_ids)
  ant_ids.add(ant_id)
  if (len(ant_ids) > old_ant_list_size):
    append_to_file("ant_ids.txt", ant_id)
    
ant_ids = set()

print 'time to fly'
prefix = 'Got payload: '
while 1:
  data = arduino.readline().strip()
  pos = data.find(prefix)
  if pos != -1:
    message = data[pos + len(prefix):]
    print "message:", json.dumps(message)
    # message is 31 bytes
    # first byte is the queen id
    queen_id = message[0:2]
    colonies = []
    ants = []
    pings = []

    # next 30 bytes are 5 payloads of 6 bytes each
    for i in range(5):
      # colony id
      colony_id = chunks(message[i*12+2:i*12+6], 2)
      colony_id.reverse()
      colony_id = ''.join(colony_id)
      colonies.append(colony_id)
      # print colonies
      # colonies[i] = ''.join(colonies[i])
      # print colonies[i]
      # ant id
      ant_id = chunks(message[i*12+6:i*12+10], 2)
      ant_id.reverse()
      ant_id = ''.join(ant_id)
      ants.append(ant_id)
      # ant[i] = ''.join(ant[i])

      # ping id
      ping_id = message[i*12+10:i*12+14]
      pings.append(ping_id)
      
      # POST that biznatch
      if colony_id != '0000' and ant_id != '0000':
        print "queen:", json.dumps(queen_id), "colony:", json.dumps(colony_id), "ant:", json.dumps(ant_id), "ping:", json.dumps(ping_id)
        post_to_server(queen_id, ant_id, ping_id, colony_id)