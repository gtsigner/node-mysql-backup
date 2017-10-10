//index.js
/**
 * From Github @https://github.com/webcaetano/mysqldump/issues/30
 */

var mysql = require('mysql');
var extend = require('extend');
var fs = require('fs');
var packageJson = require('./package.json');

/**
 *
 * @param {object} options Options for dumping
 * @param {boolean} [options.extendedInsert=true] Use multiple-row INSERT syntax
 * @param {boolean} [options.addDropTable=true] Add DROP TABLE statement before each CREATE TABLE statement
 * @param {boolean} [options.addLocks=true] Surround each table dump with LOCK TABLES and UNLOCK TABLES statements
 * @param {boolean} [options.disableKeys=true] For each table, surround INSERT statements with statements to disable and enable keys
 * @param {string} options.host Database host to connect to (IP address or hostname)
 * @param {string} options.user Database user to use when connecting to server
 * @param {string} options.password Database password to use when connecting to server
 * @param {string} options.database Database to Dump
 *
 * @param {function} callback
 */
function mysqldump(options, callback) {

  function fireCallbackOnce(err) {
    if (callbackFired) return;
    callbackFired = true;
    connection.destroy();
    writeStream.end();
    if (err && err.code !== 'ENOENT') {
      //an error occured lets delete the already created file
      fs.unlink(options.dest, callback.bind(null, err));
    } else {
      return callback(err);
    }
  }

  function streamShemaDump(table) {
    connection.query('SHOW CREATE TABLE ??', table, function (err, results) {
      if (err) return fireCallbackOnce(err);

      writeStream.write('\n\n--\n-- Table structure for table ' + connection.escapeId(table) + '\n--\n\n');
      if (options.addDropTable) {
        writeStream.write('DROP TABLE IF EXISTS ' + connection.escapeId(table) + ';\n');
      }
      var shemaDump = results[0]['Create Table'];
      writeStream.write(shemaDump + ';\n');
    });
  }

  function streamDataDump(table) {
    var fields;
    var insertIntoValuesString;
    var insertCounter = 0;
    connection.query('SELECT * FROM ??', table)
      .on('error', fireCallbackOnce)
      .on('fields', function (f) {
        fields = f;
        var columsEscaped = [];
        for (var i = 0; i < fields.length; i++) {
          columsEscaped[i] = connection.escapeId(fields[i].name);
        }
        insertIntoValuesString = 'INSERT INTO ' + connection.escapeId(table) + '(' + columsEscaped.join(', ') + ') VALUES';
      })
      .on('result', function (row) {
        var valuesEscaped = [];
        for (var i = 0; i < fields.length; i++) {
          //@todo escape fancy column types correctly
          valuesEscaped.push(connection.escape(row[fields[i].name]));
        }
        if (insertCounter === 0) {
          writeStream.write('\n--\n-- Dumping data for table ' + connection.escapeId(table) + '\n--\n\n');
          if (options.addLocks) {
            writeStream.write('LOCK TABLES ' + connection.escapeId(table) + ' WRITE;\n');
          }
          if (options.disableKeys) {
            writeStream.write('/*!40000 ALTER TABLE ' + connection.escapeId(table) + ' DISABLE KEYS */;\n');
          }
        }
        if (options.extendedInsert) {
          if (insertCounter === 0) {
            writeStream.write(insertIntoValuesString + '\n(' + valuesEscaped.join(', ') + ')');
          } else {
            writeStream.write(',\n (' + valuesEscaped.join(', ') + ')');
          }
        } else {
          writeStream.write(insertIntoValuesString + ' (' + valuesEscaped.join(', ') + ');\n');
        }
        insertCounter++;
      })
      .on('end', function () {
        if (insertCounter > 0) {
          if (options.extendedInsert) {
            writeStream.write(';\n');
          }
          if (options.disableKeys) {
            writeStream.write('/*!40000 ALTER TABLE ' + connection.escapeId(table) + ' ENABLE KEYS */;');
          }
          if (options.addLocks) {
            writeStream.write('\nUNLOCK TABLES;\n');
          }
        }
      });
  }

  function getTables(callback) {
    if (options.tables) return callback(null, options.tables);

    connection.query('SHOW TABLES', function (err, results, fields) {
      if (err) return callback(err);

      var tables = [];
      for (var i = 0; i < results.length; i++) {
        tables[i] = results[i][fields[0].name];
      }
      return callback(null, tables);
    });
  }


  var callbackFired = false;
  var defaultOptions = {
    extendedInsert: true,
    addDropTable: true,
    addLocks: true,
    disableKeys: true,
  };
  options = extend({}, defaultOptions, options);
  callback = callback || function noop() {
    };

  var connection = mysql.createConnection({
    host: options.host,
    user: options.user,
    password: options.password,
    database: options.database,
  });
  var writeStream = fs.createWriteStream(options.dest);
  writeStream.on('error', fireCallbackOnce);


  //start writing to the file
  writeStream.write('-- ' + packageJson.name + ' ' + packageJson.version + '\n--\n');
  writeStream.write('-- Dumped on ' + (new Date()).toUTCString() + '\n--\n');
  writeStream.write('-- Host: ' + options.host + '    Database: ' + options.database + '\n-- ------------------------------------------------------\n\n');

  getTables(function (err, tables) {
    if (err) return fireCallbackOnce(err);

    //we can just add all queries at once they are executed in sequence in the order of adding
    for (var i = 0; i < tables.length; i++) {
      streamShemaDump(tables[i]);
      streamDataDump(tables[i]);
    }
    connection.end(function (err) {
      if (err) return fireCallbackOnce(err);

      writeStream.on('close', function () {
        fireCallbackOnce(null); //when the file is done writing call the success callback
      });
      writeStream.end();
    });
  });
}

module.exports = mysqldump;
