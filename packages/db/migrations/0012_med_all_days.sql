-- "Días vacío = todos" en el formulario guardaba {} y el generador de tomas lo leía como "ningún día".
UPDATE "medications" SET "days_of_week" = '{1,2,3,4,5,6,7}'::smallint[] WHERE cardinality("days_of_week") = 0;
