// Assumes jQuery is loaded.

var EZBart = {

  api_key: "MW9S-E7SL-26DU-VV8V"
  ,relevantDestinations: {}

  ,setup: function() {
    EZBart.populate_stations();
    $('.mode').change(EZBart.toggleButtons);
    EZBart.populate_time_menu();
    $('.control').change(EZBart.request);
    $('#swap').click(EZBart.swapStations);
    $('#save').click(EZBart.saveFavorite);
    $('#realtime').click(EZBart.requestRealTimeDep);
    EZBart.populateFromFavorites();
    EZBart.request();
  }

  ,clearOtherInfo: function() {
    // clear previous advisories
    $('#advisories').html('').removeClass('alert').removeClass('alert-danger');
    // clear realtime departures
    $('#departures').html('').removeClass('alert').removeClass('alert-warning');
    // clear relevant dests
    EZBart.relevantDestinations = {};
  }

  ,populateFromFavorites: function() {
    var prefs;
    // if localStorage is unavailable due to permissions reasons, skip this
    try {
      prefs = localStorage.getItem('ezbart');
    } catch(err) {
      return;
    }
    if (prefs) {
      try {
        prefs = JSON.parse(prefs);
        $('#orig').prop('selectedIndex', prefs.orig);
        $('#dest').prop('selectedIndex', prefs.dest);
        $('.mode').removeClass('btn-primary').addClass('btn-outline-primary');
        $('#' + prefs.cmd).prop('checked', true).
          addClass('btn-primary').
          trigger('change');
      } catch(err) {
        // usually invalid object: reset it
        localStorage.setItem('ezbart', JSON.stringify({}));
      }
    }
  }

  ,swapStations: function() {
    var tmp = $('#orig').prop('selectedIndex');
    $('#orig').prop('selectedIndex', $('#dest').prop('selectedIndex'));
    $('#dest').prop('selectedIndex', tmp);
    // recalculate route
    $('#orig').trigger('change');
  }

  ,saveFavorite: function() {
    localStorage.setItem('ezbart', JSON.stringify({
      'orig': $('#orig').prop('selectedIndex'),
      'dest': $('#dest').prop('selectedIndex'),
      'cmd' : $('input:radio[name=cmd]:checked').attr('id')
    }));
    $('#save').fadeTo(300,0.1).fadeTo(300,1.0);
    return(false);
  }
  
  ,toggleButtons: function() {
    // change from not-checked to checked; called once for each button
    $('.mode').removeClass('btn-primary').addClass('btn-outline-primary');
    $(this).addClass('btn-primary');
  }

  ,setRealTimeDepartureLinks: function() {
    const realtimeDepsUrlBase = "https://bart.gov/schedules/eta?stn=";
    $('#origExt').attr('href', realtimeDepsUrlBase + $('#orig').val());
    $('#destExt').attr('href', realtimeDepsUrlBase + $('#dest').val());
  }
  
  ,request: function() {
    // clear other data
    EZBart.clearOtherInfo();
    // set links to external BART site
    EZBart.setRealTimeDepartureLinks();
    var cmd = $('input:radio[name=cmd]:checked').attr('id');
    var after;
    var before;
    if (cmd == "arrive") { before=3; after=1; } else { before=0; after=4; }
    var params = {
      "cmd":  cmd,
      "orig": $('#orig').val(),
      "dest": $('#dest').val(),
      "time": $('#time').val(),
      "b": before,
      "a": after,
      "json": "y",
      "key": EZBart.api_key
    };
    
    $.ajax({
      "url": "https://api.bart.gov/api/sched.aspx",
      "success": EZBart.callback,
      "error": EZBart.error,
      "data": params,
      "dataType": "json",
      "timeout": 4000
    });
  }

  ,callback: function(data, status, xhrObject) {
    var trips = data["root"]["schedule"]["request"]["trip"];
    $('#trips').html("").removeClass('alert').removeClass('alert-danger');
    for (var i=0; i < trips.length; i += 1) {
      var trip = trips[i];
      var result = EZBart.trip_to_html(trip);
      var div = $("<div class='border-top'>" + result + "</div>");
      $('#trips').append(div);
    }
    // also trigger a search for advisories
    EZBart.requestAdvisories();
  }

  ,trip_to_html: function(trip) {
    var leg = trip.leg;
    var numLegs = leg.length;
    var origTime = leg[0]["@origTimeMin"];
    var destTime = leg[numLegs-1]["@destTimeMin"];
    var result = "<div class='text-primary font-weight-bold'>" +
        EZBart.formatTime(origTime) + "&nbsp;&rarr;&nbsp;" + EZBart.formatTime(destTime) +
        "</div>" +
        "<div class='text-secondary'>" + leg[0]["@trainHeadStation"] + " train";
    // add the first leg of each trip to relevant destinations for RealTimeDepartures
    EZBart.addRelevantDestination(leg[0]);
    if (numLegs > 1) {
      result += ", change at " + EZBart.abbrevs[leg[1]["@origin"].toLowerCase()] +
        " for " + leg[1]["@trainHeadStation"] + " train";
      if (numLegs > 2) {
        result += ", then at " + EZBart.abbrevs[leg[2]["@origin"].toLowerCase()] +
          " for " + leg[2]["@trainHeadStation"] + " train";
      }
    }
    result += "</div>";
    return(result);
  }
  ,addRelevantDestination: function(leg) {
    var routeAlias = EZBart.routeAliases[leg["@trainHeadStation"]];
    EZBart.relevantDestinations[routeAlias] = true;
  }
  ,requestRealTimeDep: function() {
    $.ajax({
      "url": "https://api.bart.gov/api/etd.aspx",
      "success": EZBart.parseRealTimeDep,
      "dataType": "json",
      "timeout": 4000,
      "data": {
        "cmd":  "etd",
        "orig": $('#orig').val(),
        "json": "y",
        "key": EZBart.api_key
      }
    });
  }
  ,parseRealTimeDep: function(data,status,xhrObj) {
    var nowPlusMinutes = function(min) { 
      if (min == "Leaving") {
        return(min);
      } else {
        // why is there no goddamn sprintf or strftime
        var newDate = new Date(Date.now() + 1000*60*parseInt(min));
        return(newDate.getHours().toString() + ":" + 
               ("0" + newDate.getMinutes().toString()).slice(-2));
      }
    }
    var formatDepartureTime = function(est) {
      if (est.cancelflag == "0") {
        return(nowPlusMinutes(est.minutes));
      } else {
        return('<s class="text-danger">' + nowPlusMinutes(est.minutes) + '</s>');
      }
    }
    var deps = [];
    for (const route of data['root']['station'][0]['etd']) {
      if (EZBart.relevantDestinations[route['destination']]) {
        //  tbd: check if route.estimate[n].cancelflag is not "0" to show cxld trip
        deps.push(route['destination'] + ': ' +
                  route['estimate'].map(formatDepartureTime).join(', '));
      }
    }
    if (deps.length > 0) {
      $('#departures').addClass('alert').addClass('alert-warning').html(deps.join('<br>'));
    }
  }
  ,requestAdvisories: function() {
    $.ajax({
      "url": "https://api.bart.gov/api/bsa.aspx",
      "success": EZBart.parseAdvisories,
      "dataType": "json",
      "timeout": 4000,
      "data": {
        "cmd":  "bsa",
        "json": "y",
        "key": EZBart.api_key
      }
    });
  }
  ,parseAdvisories: function(data,status,xhrObj) {
    var msg;
    try {
      msg = data['root']['bsa'][0]['description']['#cdata-section'];
      if (msg != 'No delays reported.') {
        $('#advisories').addClass('alert').addClass('alert-danger').text(msg);
        // if there are advisories, also show realtime departure info
        EZBart.requestRealTimeDep();
      }
    } catch(err) {
    }
  }

  ,error: function(xhrObject, errorString, exceptionObject) {
    $('#trips').addClass('alert').addClass('alert-danger').text("BART site error: " + errorString);
  }

  ,populate_time_menu: function() {
    var now = new Date(Date.now());
    var index = 4 * Math.floor(now.getHours() - 4) +
        (Math.floor(now.getMinutes() / 15)) + 1;
    var maxindex = EZBart.times.length - 1;
    if (index < 0) { index = 0 };
    if (index > maxindex) { index = maxindex; }
    for (var i=0; i <= maxindex; i += 1) {
      var time = EZBart.times[i];
      var opt = $('<option></option>').attr("value", time).text(time);
      // let the current time be selected
      if (i == index) {
        opt.attr("selected", "selected");
      }
      $('#time').append(opt);
    }
  }
  ,formatTime: function(time) {
    // 05:35 PM => 17:35
    if (EZBart.amPm) { return(time); }
    var hour = parseInt(time.slice(0,2));
    if (time.slice(-2) == 'PM'  &&  hour < 12) {
      hour += 12;
    }
    return(hour.toString() + ':' + time.slice(3,5));
  }
  ,times: [
    '4:00 am', '4:15 am', '4:30 am', '4:45 am', 
    '5:00 am', '5:15 am', '5:30 am', '5:45 am', 
    '6:00 am', '6:15 am', '6:30 am', '6:45 am', 
    '7:00 am', '7:15 am', '7:30 am', '7:45 am', 
    '8:00 am', '8:15 am', '8:30 am', '8:45 am', 
    '9:00 am', '9:15 am', '9:30 am', '9:45 am', 
    '10:00 am', '10:15 am', '10:30 am', '10:45 am', 
    '11:00 am', '11:15 am', '11:30 am', '11:45 am', 
    '12:00 pm', '12:15 pm', '12:30 pm', '12:45 pm', 
    '1:00 pm', '1:15 pm', '1:30 pm', '1:45 pm', 
    '2:00 pm', '2:15 pm', '2:30 pm', '2:45 pm', 
    '3:00 pm', '3:15 pm', '3:30 pm', '3:45 pm', 
    '4:00 pm', '4:15 pm', '4:30 pm', '4:45 pm', 
    '5:00 pm', '5:15 pm', '5:30 pm', '5:45 pm', 
    '6:00 pm', '6:15 pm', '6:30 pm', '6:45 pm', 
    '7:00 pm', '7:15 pm', '7:30 pm', '7:45 pm', 
    '8:00 pm', '8:15 pm', '8:30 pm', '8:45 pm', 
    '9:00 pm', '9:15 pm', '9:30 pm', '9:45 pm', 
    '10:00 pm', '10:15 pm', '10:30 pm', '10:45 pm', 
    '11:00 pm', '11:15 pm', '11:30 pm', '11:45 pm'
  ]

  
  ,populate_stations: function() {
    $.each(EZBart.abbrevs, function(val, display_string) {
      $('#dest,#orig').append(
        $('<option></option>').attr("value", val).text(display_string));
    });
    // make sure they don't have the same station selected, or error happens
    $('#dest').prop('selectedIndex', 1 + $('#orig').prop('selectedIndex'));
  }
  ,abbrevs: {
    // from https://api.bart.gov/docs/overview/abbrev.aspx
    "12th": "12th St. Oakland City Center",
    "16th": "16th St. Mission (SF)",
    "19th": "19th St. Oakland",
    "24th": "24th St. Mission (SF)",
    "ashb": "Ashby (Berkeley)",
    "antc": "Antioch",
    "balb": "Balboa Park (SF)",
    "bayf": "Bay Fair (San Leandro)",
    "bery": "Berryessa",
    "cast": "Castro Valley",
    "civc": "Civic Center (SF)",
    "cols": "Coliseum",
    "colm": "Colma",
    "conc": "Concord",
    "daly": "Daly City",
    "dbrk": "Downtown Berkeley",
    "dubl": "Dublin/Pleasanton",
    "deln": "El Cerrito del Norte",
    "plza": "El Cerrito Plaza",
    "embr": "Embarcadero (SF)",
    "frmt": "Fremont",
    "ftvl": "Fruitvale (Oakland)",
    "glen": "Glen Park (SF)",
    "hayw": "Hayward",
    "lafy": "Lafayette",
    "lake": "Lake Merritt (Oakland)",
    "mcar": "MacArthur (Oakland)",
    "mlbr": "Millbrae",
    "mlpt": "Milpitas",
    "mont": "Montgomery St. (SF)",
    "nbrk": "North Berkeley",
    "ncon": "North Concord/Martinez",
    "oakl": "Oakland Int'l Airport",
    "orin": "Orinda",
    "pitt": "Pittsburg/Bay Point",
    "pctr": "Pittsburg Center",
    "phil": "Pleasant Hill",
    "powl": "Powell St. (SF)",
    "rich": "Richmond",
    "rock": "Rockridge (Oakland)",
    "sbrn": "San Bruno",
    "sfia": "San Francisco Int'l Airport",
    "sanl": "San Leandro",
    "shay": "South Hayward",
    "ssan": "South San Francisco",
    "ucty": "Union City",
    "warm": "Warm Springs/South Fremont",
    "wcrk": "Walnut Creek",
    "wdub": "West Dublin",
    "woak": "West Oakland"
  }

  ,routeAliases: {
    "San Francisco International Airport" : "SF Airport",
    "OAK Airport / Berryessa/North San Jose" : "Berryessa",
    // the following routes are named the same as their end stations
    "Daly City" : "Daly City",
    "Millbrae" : "Millbrae",
    "SF / Millbrae / SFO Airport" : "Millbrae/SFO",
    "Antioch" : "Antioch",
    "SF / OAK Airport / Dublin/Pleasanton" : "Dublin/Pleasanton",
    "SF / OAK Airport / Berryessa" : "Berryessa",
    "Richmond" : "Richmond"
  }

}

$(EZBart.setup);
